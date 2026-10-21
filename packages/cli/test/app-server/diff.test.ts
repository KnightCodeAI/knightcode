import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffFile, ParamsOf } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import { type NameStatus, splitPatch } from "../../src/app-server/diff.ts";
import { attachJsonlLineReader } from "../../src/modes/rpc/jsonl.ts";
import { makeRepo, sh, write } from "./fixtures/git-repo.ts";
import { type RepoServer, repoServer, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers, startServer, stopChild, tempDir } from "./harness.ts";

afterEach(cleanupServers);

const POSIX = process.platform !== "win32";

async function localThread(s: RepoServer) {
	return (await s.a.client.request("thread/start", { cwd: s.cwd })).thread;
}

function read(s: RepoServer, threadId: string, params: Omit<ParamsOf<"thread/diff/read">, "threadId"> = {}) {
	return s.a.client.request("thread/diff/read", { threadId, ...params });
}

const byPath = (files: DiffFile[]) => Object.fromEntries(files.map((f) => [f.path, f]));
const seven = (changes: Record<number, string> = {}) =>
	`${[1, 2, 3, 4, 5, 6, 7].map((n) => changes[n] ?? String(n)).join("\n")}\n`;

test("uncommitted shows a modified and an added file and never writes the index", async () => {
	const s = await repoServer();
	const thread = await localThread(s);
	write(s.cwd, "a.txt", "one\nTWO\nthree\n");
	write(s.cwd, "new.txt", "untracked\n");
	const index = readFileSync(join(s.cwd, ".git", "index"));
	const { scope, files } = await read(s, thread.id);
	expect(scope).toBe("uncommitted");
	const f = byPath(files);
	expect(f["a.txt"]).toMatchObject({ status: "modified", additions: 1, deletions: 1, binary: false });
	expect(f["a.txt"].hunks[0].lines).toEqual([" one", "-two", "+TWO", " three"]);
	expect(f["new.txt"]).toMatchObject({ status: "added" });
	expect(f["new.txt"].hunks[0].lines).toEqual(["+untracked"]);
	expect(readFileSync(join(s.cwd, ".git", "index")).equals(index)).toBe(true);
});

test("staged and unstaged split one file's index and working tree changes", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const thread = await localThread(s);
	write(s.cwd, "a.txt", seven({ 1: "ONE" }));
	sh(s.cwd, "add", "a.txt");
	write(s.cwd, "a.txt", seven({ 1: "ONE", 7: "SEVEN" }));
	const staged = (await read(s, thread.id, { scope: "staged", context: 0 })).files;
	const unstaged = (await read(s, thread.id, { scope: "unstaged", context: 0 })).files;
	expect(staged).toHaveLength(1);
	expect(staged[0].hunks.map((h) => h.oldStart)).toEqual([1]);
	expect(unstaged[0].hunks.map((h) => h.oldStart)).toEqual([7]);
});

test("a worktree thread's branch diff ignores commits made in the main checkout", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	write(thread.cwd, "a.txt", "one\nworktree\nthree\n");
	const before = await read(s, thread.id, { scope: "branch" });
	write(s.cwd, "main.txt", "m");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "main moves");
	const after = await read(s, thread.id, { scope: "branch" });
	expect(after).toEqual(before);
	expect(before.files.map((f) => f.path)).toEqual(["a.txt"]);
	expect(before.against).toBe(thread.workspace.mode === "worktree" ? thread.workspace.baseRef : "");
});

test("branch compares a local thread with its upstream, with an explicit branch, and refuses with neither", async () => {
	const s = await repoServer();
	const origin = join(tempDir("kc-origin-"), "o.git");
	sh(s.cwd, "clone", "-q", "--bare", s.cwd, origin);
	sh(s.cwd, "remote", "add", "origin", origin);
	sh(s.cwd, "fetch", "-q", "origin");
	sh(s.cwd, "branch", "-q", "--set-upstream-to=origin/main", "main");
	write(s.cwd, "ahead.txt", "a");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "ahead");
	write(s.cwd, "a.txt", "edited\n");
	const thread = await localThread(s);
	const upstream = await read(s, thread.id, { scope: "branch" });
	expect(upstream.against).toBe("origin/main");
	expect(upstream.files.map((f) => f.path).sort()).toEqual(["a.txt", "ahead.txt"]);
	sh(s.cwd, "checkout", "-q", "-b", "feature");
	write(s.cwd, "feature.txt", "f");
	sh(s.cwd, "add", "feature.txt");
	sh(s.cwd, "commit", "-q", "-m", "feature");
	const explicit = await read(s, thread.id, { scope: "branch", against: "main" });
	expect(explicit.files.map((f) => f.path).sort()).toEqual(["a.txt", "feature.txt"]);

	const bare = await repoServer();
	sh(bare.cwd, "branch", "-m", "trunk");
	const lonely = await localThread(bare);
	await expect(read(bare, lonely.id, { scope: "branch" })).rejects.toMatchObject({ code: "invalidParams" });
});

test("committed shows exactly one commit; a root commit adds every file; no commit is invalidParams", async () => {
	const s = await repoServer({ "a.txt": "a\n", "b.txt": "b\n" });
	const root = sh(s.cwd, "rev-parse", "HEAD");
	write(s.cwd, "a.txt", "A\n");
	sh(s.cwd, "commit", "-q", "-am", "edit a");
	const edit = sh(s.cwd, "rev-parse", "HEAD");
	write(s.cwd, "b.txt", "uncommitted\n");
	const thread = await localThread(s);
	const one = await read(s, thread.id, { scope: "committed", commit: edit });
	expect(one.files.map((f) => [f.path, f.status])).toEqual([["a.txt", "modified"]]);
	const first = await read(s, thread.id, { scope: "committed", commit: root });
	expect(first.files.map((f) => [f.path, f.status])).toEqual([
		["a.txt", "added"],
		["b.txt", "added"],
	]);
	await expect(read(s, thread.id, { scope: "committed" })).rejects.toMatchObject({ code: "invalidParams" });
	await expect(read(s, thread.id, { scope: "committed", commit: "nope" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("ignoreWhitespace hides a change that only re-indents a line", async () => {
	const s = await repoServer({ "a.txt": "one\ntwo\nthree\n", "b.txt": "x\n" });
	const thread = await localThread(s);
	write(s.cwd, "a.txt", "one\n    two\nthree\n");
	write(s.cwd, "b.txt", "y\n");
	expect((await read(s, thread.id)).files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
	expect((await read(s, thread.id, { ignoreWhitespace: true })).files.map((f) => f.path)).toEqual(["b.txt"]);
});

test("more than 500 untracked files leaves them out and counts them", async () => {
	const s = await repoServer();
	const thread = await localThread(s);
	for (let i = 0; i < 501; i++) write(s.cwd, `gen/${i}.txt`, String(i));
	write(s.cwd, "a.txt", "edited\n");
	const result = await read(s, thread.id);
	expect(result.files.map((f) => f.path)).toEqual(["a.txt"]);
	expect(result.untrackedSkipped).toBe(501);
});

test("a large context gives whole files as one hunk", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const thread = await localThread(s);
	write(s.cwd, "a.txt", seven({ 1: "ONE", 7: "SEVEN" }));
	expect((await read(s, thread.id, { context: 1_000_000 })).files[0].hunks).toHaveLength(1);
	expect((await read(s, thread.id, { context: 0 })).files[0].hunks).toHaveLength(2);
});

test("renames, deletions and binary files", async () => {
	const s = await repoServer({ "a.txt": "rename me\nplease\n", "c.txt": "delete me\n", "bin.png": "\x89PNG" });
	const thread = await localThread(s);
	sh(s.cwd, "mv", "a.txt", "b.txt");
	unlinkSync(join(s.cwd, "c.txt"));
	writeFileSync(join(s.cwd, "bin.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
	const f = byPath((await read(s, thread.id)).files);
	expect(f["b.txt"]).toMatchObject({ status: "renamed", oldPath: "a.txt" });
	expect(f["c.txt"]).toMatchObject({ status: "deleted", deletions: 1 });
	expect(f["bin.png"]).toMatchObject({ status: "modified", binary: true, hunks: [] });
});

test("unusual paths pair with their own hunks", async () => {
	const names = ["a b.txt", "ü.txt", "-dash.txt", ...(POSIX ? ['quote".txt', "tab\tname.txt"] : [])];
	const s = await repoServer(Object.fromEntries(names.map((n) => [n, `${n}\n`])));
	const thread = await localThread(s);
	for (const name of names) write(s.cwd, name, `${name} edited\n`);
	const f = byPath((await read(s, thread.id)).files);
	for (const name of names) expect(f[name].hunks[0].lines).toEqual([`-${name}`, `+${name} edited`]);
});

test.skipIf(!POSIX)("a file replaced by a symlink is one typeChanged file", async () => {
	const s = await repoServer({ "a.txt": "a\n", "t.txt": "target\n" });
	const thread = await localThread(s);
	unlinkSync(join(s.cwd, "a.txt"));
	symlinkSync("t.txt", join(s.cwd, "a.txt"));
	const files = (await read(s, thread.id)).files;
	expect(files.map((f) => [f.path, f.status])).toEqual([["a.txt", "typeChanged"]]);
});

test("a worktree that carried local changes shows them before its first turn", async () => {
	const s = await repoServer();
	write(s.cwd, "a.txt", "carried\n");
	const { thread } = await worktreeThread(s, { carryLocalChanges: true });
	for (const scope of ["uncommitted", "branch"] as const)
		expect((await read(s, thread.id, { scope })).files.map((f) => f.path)).toEqual(["a.txt"]);
});

test("lastTurn with no recorded turn is empty", async () => {
	const s = await repoServer();
	const thread = await localThread(s);
	expect(await read(s, thread.id, { scope: "lastTurn" })).toEqual({ scope: "lastTurn", files: [] });
});

test("outside git a diff read answers notGitRepo", async () => {
	const s = await startServer();
	const a = await s.connect("desktop");
	const { thread } = await a.client.request("thread/start", { cwd: s.cwd });
	await expect(a.client.request("thread/diff/read", { threadId: thread.id })).rejects.toMatchObject({
		code: "notGitRepo",
	});
});

for (const format of ["sha1", "sha256"]) {
	test(`an unborn ${format} repository lists staged and untracked files`, async () => {
		const s = await startServer();
		sh(s.cwd, "init", "-q", "-b", "main", `--object-format=${format}`);
		write(s.cwd, "staged.txt", "s\n");
		sh(s.cwd, "add", "staged.txt");
		write(s.cwd, "untracked.txt", "u\n");
		const a = await s.connect("desktop");
		const { thread } = await a.client.request("thread/start", { cwd: s.cwd });
		const staged = await a.client.request("thread/diff/read", { threadId: thread.id, scope: "staged" });
		expect(staged.files.map((f) => f.path)).toEqual(["staged.txt"]);
		const all = await a.client.request("thread/diff/read", { threadId: thread.id });
		expect(all.files.map((f) => f.path)).toEqual(["staged.txt", "untracked.txt"]);
	});
}

test("small test budgets list what fits and count the rest", async () => {
	const files = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`d/${i}.txt`, `${i}\n`]));
	const s = await repoServer(files, { diffBudgets: { serialized: 64 * 1024, metadata: 96 * 1024 } });
	const thread = await localThread(s);
	rmSync(join(s.cwd, "d"), { recursive: true });
	const result = await read(s, thread.id);
	expect(Buffer.byteLength(JSON.stringify(result.files))).toBeLessThanOrEqual(96 * 1024);
	expect(result.filesOmitted).toBeGreaterThan(0);
	expect(result.files.length + result.filesOmitted!).toBe(2000);
	expect(result.files.some((f) => f.tooLarge)).toBe(true);
});

test("splitPatch pairs quoted paths, renames, a two-section type change, no-newline markers and empty files", () => {
	const patch = [
		'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
		"index 1111111..2222222 100644",
		'--- "a/q\\"uote.txt"',
		'+++ "b/q\\"uote.txt"',
		"@@ -1 +1 @@",
		"-a",
		"\\ No newline at end of file",
		"+b",
		"\\ No newline at end of file",
		"diff --git a/old.txt b/new.txt",
		"similarity index 90%",
		"rename from old.txt",
		"rename to new.txt",
		"diff --git a/t b/t",
		"deleted file mode 100644",
		"index 3333333..0000000",
		"--- a/t",
		"+++ /dev/null",
		"@@ -1 +0,0 @@",
		"-file",
		"diff --git a/t b/t",
		"new file mode 120000",
		"index 0000000..4444444",
		"--- /dev/null",
		"+++ b/t",
		"@@ -0,0 +1 @@",
		"+target",
		"\\ No newline at end of file",
		"diff --git a/empty.txt b/empty.txt",
		"new file mode 100644",
		"index 0000000..e69de29",
		"",
	].join("\n");
	const names: NameStatus[] = [
		{ status: "M", path: 'q"uote.txt' },
		{ status: "R", path: "new.txt", oldPath: "old.txt" },
		{ status: "T", path: "t" },
		{ status: "A", path: "empty.txt" },
	];
	const sections = splitPatch(names, Buffer.from(patch));
	expect(names.map((n) => sections.get(n)?.length)).toEqual([1, 1, 2, 1]);
	expect(sections.get(names[0])![0].toString()).toContain("No newline");
	expect(sections.get(names[3])![0].toString()).toContain("e69de29");
});

test("a diff past the serialized budget over real stdio keeps whole early files and later ones as metadata", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
	const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "knightcode-as-e2e-cwd-")));
	const original = Array.from({ length: 36_000 }, () => "a").join("\n");
	const changed = Array.from({ length: 36_000 }, (_, i) => (i % 2 ? "b" : "a")).join("\n");
	makeRepo(
		cwd,
		Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${String(i).padStart(2, "0")}.txt`, `${original}\n`])),
	);
	for (let i = 0; i < 30; i++) write(cwd, `f${String(i).padStart(2, "0")}.txt`, `${changed}\n`);
	// The fixture: neither raw limit applies, only the serialized budget can.
	const diffBytes = (...paths: string[]) =>
		spawnSync("git", ["diff", "-U0", "--", ...paths], { cwd, maxBuffer: 64 * 1024 * 1024 }).stdout.length;
	expect(diffBytes()).toBeLessThan(16 * 1024 * 1024);
	expect(diffBytes("f00.txt")).toBeLessThan(512 * 1024);
	const child: ChildProcess = spawn(
		"bun",
		["src/cli.ts", "app-server", "-e", join(import.meta.dirname, "fixtures/faux-extension.ts")],
		{
			cwd: join(import.meta.dirname, "../.."),
			env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir },
			stdio: ["pipe", "pipe", "inherit"],
		},
	);
	const replies = new Map<number, Record<string, unknown>>();
	const waiters = new Set<() => void>();
	attachJsonlLineReader(child.stdout!, (line) => {
		const message = JSON.parse(line) as Record<string, unknown>;
		if (typeof message.id === "number") replies.set(message.id, message);
		for (const wake of [...waiters]) wake();
	});
	const reply = (id: number) =>
		new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`timed out waiting for ${id}`)), 90_000);
			const check = () => {
				const hit = replies.get(id);
				if (!hit) return;
				clearTimeout(timer);
				waiters.delete(check);
				resolve(hit);
			};
			waiters.add(check);
			check();
		});
	const send = (message: unknown) => child.stdin!.write(`${JSON.stringify(message)}\n`);
	try {
		send({ id: 1, method: "initialize", params: { clientInfo: { name: "e2e", version: "0" }, capabilities: {} } });
		await reply(1);
		send({ method: "initialized", params: {} });
		send({ id: 2, method: "thread/start", params: { cwd } });
		const threadId = ((await reply(2)).result as { thread: { id: string } }).thread.id;
		send({ id: 3, method: "thread/diff/read", params: { threadId, context: 0 } });
		const result = (await reply(3)).result as { files: DiffFile[] };
		expect(result.files).toHaveLength(30);
		expect(result.files[0].hunks).toHaveLength(18_000);
		expect(result.files.at(-1)).toMatchObject({ tooLarge: true, hunks: [] });
		send({ id: 4, method: "thread/diff/read", params: { threadId, scope: "staged" } });
		expect((await reply(4)).result).toMatchObject({ files: [] });
	} finally {
		await stopChild(child);
		rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}, 180_000);
