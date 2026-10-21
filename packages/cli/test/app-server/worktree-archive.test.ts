import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { workspaceHooks } from "../../src/app-server/workspaces.ts";
import { makeRepo, sh, write } from "./fixtures/git-repo.ts";
import { createGate } from "./fixtures/gate-extension.ts";
import { type RepoServer, repoServer, say, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers, startServer, stopChild, tempDir } from "./harness.ts";

afterEach(cleanupServers);

const WIN = process.platform === "win32";
const layouts = [{ name: "explicit session dir" }, { name: "default layout", sessionDir: null }] as const;

function gate() {
	let open!: () => void;
	let entered!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	const reached = new Promise<void>((resolve) => (entered = resolve));
	return { opened, reached, open, enter: () => entered() };
}

async function saved(s: RepoServer, request: object = {}) {
	const { thread } = await worktreeThread(s, request);
	await say(s, thread.id);
	if (thread.workspace.mode !== "worktree") throw new Error("unreachable");
	return { thread, path: thread.workspace.path };
}
const manifestOf = (path: string) => JSON.parse(readFileSync(join(dirname(path), "worktree.json"), "utf8"));
const archive = (s: RepoServer, threadId: string) => s.a.client.request("thread/archive", { threadId });
const restore = (s: RepoServer, threadId: string) => s.a.client.request("thread/worktree/restore", { threadId });
function settings(s: RepoServer, worktrees: object) {
	writeFileSync(join(s.agentDir, "settings.json"), JSON.stringify({ worktrees }));
}
const snapshotRefs = (dir: string) =>
	sh(dir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/knightcode/snapshots/")
		.split("\n")
		.filter(Boolean);

test("archive snapshots and deletes the worktree; restore brings back the files, the index and HEAD", async () => {
	const s = await repoServer({ ".gitignore": "*.log\n", "a.txt": "a\n", "b.txt": "b\n" });
	const { thread, path } = await saved(s);
	write(path, "c.txt", "committed\n");
	sh(path, "add", "-A");
	sh(path, "commit", "-q", "-m", "worktree commit");
	const head = sh(path, "rev-parse", "HEAD");
	write(path, "a.txt", "staged\n");
	sh(path, "add", "a.txt");
	write(path, "a.txt", "working\n");
	write(path, "gone.txt", "staged then deleted\n");
	sh(path, "add", "gone.txt");
	rmSync(join(path, "gone.txt"));
	write(path, "u.txt", "untracked\n");
	write(path, "debug.log", "ignored\n");
	const cached = sh(path, "diff", "--cached");
	const working = sh(path, "diff");
	const result = await archive(s, thread.id);
	expect(result.worktree).toMatchObject({ deleted: true, snapshot: expect.any(String) });
	const [ref] = snapshotRefs(s.cwd);
	expect(ref).toContain(`refs/knightcode/snapshots/${basename(dirname(path))}/`);
	expect(ref.endsWith(result.worktree!.snapshot!)).toBe(true);
	expect(sh(s.cwd, "rev-parse", `${result.worktree!.snapshot}^1`)).toBe(head);
	expect(existsSync(path)).toBe(false);
	expect(manifestOf(path).deleted).toMatchObject({ reason: "archive", snapshot: result.worktree!.snapshot });
	await s.a.client.request("thread/unarchive", { threadId: thread.id });
	await expect(s.a.client.request("thread/resume", { threadId: thread.id })).rejects.toMatchObject({
		data: { reason: "worktreeDeleted" },
	});
	expect((await s.a.client.request("thread/read", { threadId: thread.id })).thread.id).toBe(thread.id);
	const { thread: back } = await restore(s, thread.id);
	expect(back.cwd).toBe(path);
	expect(() => sh(path, "symbolic-ref", "-q", "HEAD")).toThrow();
	expect(sh(path, "rev-parse", "HEAD")).toBe(head);
	expect(sh(path, "diff", "--cached")).toBe(cached);
	expect(sh(path, "diff")).toBe(working);
	expect(sh(path, "status", "--porcelain")).toContain("?? u.txt");
	expect(existsSync(join(path, "debug.log"))).toBe(false);
	expect(manifestOf(path).deleted).toBeUndefined();
	await say(s, thread.id);
});

test("an edited skip-worktree file survives archive and restore", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	sh(path, "update-index", "--skip-worktree", "a.txt");
	write(path, "a.txt", "hidden edit\n");
	await archive(s, thread.id);
	await s.a.client.request("thread/unarchive", { threadId: thread.id });
	await restore(s, thread.id);
	expect(readFileSync(join(path, "a.txt"), "utf8")).toBe("hidden edit\n");
});

test("autoDelete off keeps the worktree; a sibling that is not archived keeps it in use", async () => {
	const s = await repoServer();
	settings(s, { autoDelete: false });
	const first = await saved(s);
	expect((await archive(s, first.thread.id)).worktree).toEqual({ deleted: false, reason: "autoDeleteOff" });
	expect(existsSync(first.path)).toBe(true);
	settings(s, {});
	const second = await saved(s);
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: second.thread.id });
	await say(s, fork.id);
	await s.threads.unload(fork.id);
	expect((await archive(s, second.thread.id)).worktree).toEqual({ deleted: false, reason: "inUse" });
	expect(existsSync(second.path)).toBe(true);
});

test("two threads of one worktree archived at once both settle, and the worktree is deleted once", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: thread.id });
	await say(s, fork.id);
	const results = await Promise.all([archive(s, thread.id), archive(s, fork.id)]);
	expect(results.some((r) => r.worktree?.deleted)).toBe(true);
	expect(existsSync(path)).toBe(false);
	expect(snapshotRefs(s.cwd)).toHaveLength(1);
});

test("an archive while a sibling's load is parked keeps the worktree, and the sibling loads", async () => {
	const g = createGate(2);
	const s = await repoServer(undefined, { extraExtensions: [{ name: "gate", factory: g.extension }] });
	const { thread, path } = await saved(s);
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: thread.id });
	await say(s, fork.id);
	await s.threads.unload(fork.id);
	const resuming = s.a.client.request("thread/resume", { threadId: fork.id });
	await g.entered;
	try {
		expect((await archive(s, thread.id)).worktree).toEqual({ deleted: false, reason: "inUse" });
	} finally {
		g.open();
	}
	expect((await resuming).thread.cwd).toBe(path);
	expect(existsSync(path)).toBe(true);
});

test("a resume that arrives while the deletion is past its fence waits and answers worktreeDeleted", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: thread.id });
	await say(s, fork.id);
	await s.a.client.request("thread/archive", { threadId: fork.id });
	const parked = gate();
	const original = workspaceHooks.afterUserCheck;
	workspaceHooks.afterUserCheck = async () => {
		parked.enter();
		await parked.opened;
	};
	let archiving: Promise<unknown> | undefined;
	let resuming: Promise<unknown> | undefined;
	try {
		archiving = archive(s, thread.id);
		await parked.reached;
		await s.a.client.request("thread/unarchive", { threadId: fork.id });
		resuming = s.a.client.request("thread/resume", { threadId: fork.id }).catch((e: unknown) => e);
	} finally {
		parked.open();
		workspaceHooks.afterUserCheck = original;
	}
	await archiving;
	expect(await resuming).toMatchObject({ data: { reason: "worktreeDeleted" } });
	expect(existsSync(path)).toBe(false);
});

test("pruning past keep deletes the least recently used worktree, never a loaded one", async () => {
	const s = await repoServer();
	const old = await saved(s);
	const loaded = await saved(s);
	const middle = await saved(s);
	await s.threads.unload(old.thread.id);
	await s.threads.unload(middle.thread.id);
	// The loaded thread's worktree is the oldest; pruning must pass over it.
	for (const [path, at] of [
		[loaded.path, 1],
		[old.path, 2],
		[middle.path, 3],
	] as const)
		writeFileSync(join(dirname(path), "worktree.json"), JSON.stringify({ ...manifestOf(path), lastUsedAt: at }));
	settings(s, { keep: 3 });
	const newest = await saved(s);
	await expect.poll(() => existsSync(old.path), { timeout: 15_000 }).toBe(false);
	expect(manifestOf(old.path).deleted).toMatchObject({ reason: "prune", snapshot: expect.any(String) });
	for (const path of [loaded.path, middle.path, newest.path]) expect(existsSync(path)).toBe(true);
});

test("the cleanup script runs before removal with the setup's two paths; a failing one still deletes and warns", async () => {
	for (const failing of [false, true]) {
		const s = await repoServer();
		const record = join(s.agentDir, "cleanup.txt").replace(/\\/g, "/");
		await s.a.client.request("environment/save", {
			cwd: s.cwd,
			environments: [
				{
					name: "e",
					cleanup: {
						default: `echo cleaning; echo "$KNIGHTCODE_SOURCE_TREE_PATH|$KNIGHTCODE_WORKTREE_PATH|$(test -d "$KNIGHTCODE_WORKTREE_PATH" && echo present)" > "${record}"${failing ? "; exit 4" : ""}`,
					},
				},
			],
		});
		await s.a.client.request("project/trust/set", { cwd: s.cwd, trusted: true });
		const { thread, path } = await saved(s, { environment: "e" });
		await archive(s, thread.id);
		const [source, worktree, present] = readFileSync(join(s.agentDir, "cleanup.txt"), "utf8").trim().split("|");
		const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
		expect(norm(source)).toBe(norm(s.root));
		expect(norm(worktree)).toBe(norm(path));
		expect(present).toBe("present");
		expect(existsSync(path)).toBe(false);
		// The archiving client gets the cleanup's output, as a start gets its setup's.
		const progress = s.a.notifications.filter((n) => n.method === "thread/workspace/progress");
		expect(progress.every((n) => n.params.threadId === thread.id && n.params.phase === "cleanup")).toBe(true);
		expect(progress.map((n) => n.params.output).join("")).toContain("cleaning");
		if (failing) await s.a.waitFor("warning", (p) => String(p.message).includes("cleanup"));
	}
});

test("worktree/list shows each worktree with its threads; worktree/delete refuses one in use", async () => {
	const s = await repoServer();
	const first = await saved(s);
	const second = await saved(s);
	await archive(s, second.thread.id);
	const { worktrees } = await s.a.client.request("worktree/list", { cwd: s.cwd });
	const byPath = Object.fromEntries(worktrees.map((w) => [w.path, w]));
	expect(byPath[first.path]).toMatchObject({ projectCwd: s.root, deleted: false, threadIds: [first.thread.id] });
	expect(byPath[first.path].head).toBe(sh(first.path, "rev-parse", "HEAD"));
	expect(byPath[second.path]).toMatchObject({ deleted: true });
	expect(byPath[second.path].head).toBeUndefined();
	await expect(s.a.client.request("worktree/delete", { path: first.path })).rejects.toMatchObject({
		data: { reason: "worktreeInUse" },
	});
	await expect(s.a.client.request("worktree/delete", { path: s.cwd })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("a thread of the worktree open in another process fences it from deletion until it closes", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	// Archived here, with the worktree kept: only the other process's lock still holds it.
	settings(s, { autoDelete: false });
	await archive(s, thread.id);
	settings(s, {});
	const file = readdirSync(s.sessionDir, { recursive: true, encoding: "utf8" }).find(
		(name) => name.endsWith(".jsonl") && name.includes(thread.id),
	);
	if (!file) throw new Error("no session file");
	const holder = spawn(
		process.execPath,
		[join(import.meta.dirname, "../fixtures/hold-session-lock.ts"), join(s.sessionDir, file)],
		{
			stdio: ["pipe", "pipe", "inherit"],
		},
	);
	try {
		// A holder that fails before taking the lock fails the test now, not at the runner's timeout.
		await new Promise<void>((resolve, reject) => {
			holder.stdout!.once("data", () => resolve());
			holder.once("error", reject);
			holder.once("exit", (code) => reject(new Error(`lock holder exited with ${code} before taking the lock`)));
		});
		await expect(s.a.client.request("worktree/delete", { path })).rejects.toMatchObject({
			data: { reason: "worktreeInUse" },
		});
		expect(existsSync(path)).toBe(true);
	} finally {
		// Closing stdin releases the lock and exits; stopChild only if it does not.
		const exited = new Promise<void>((resolve) => holder.once("exit", () => resolve()));
		holder.stdin!.end();
		let timer: NodeJS.Timeout | undefined;
		await Promise.race([exited, new Promise((resolve) => (timer = setTimeout(resolve, 10_000)))]);
		clearTimeout(timer);
		await stopChild(holder);
	}
	expect(await s.a.client.request("worktree/delete", { path })).toMatchObject({ snapshot: expect.any(String) });
});

test("the user's own worktrees and stale registrations survive every deletion and prune", async () => {
	const s = await repoServer();
	const own = join(tempDir("kc-own-"), "own");
	sh(s.cwd, "worktree", "add", "-q", "--detach", own);
	const stale = join(tempDir("kc-stale-"), "stale");
	sh(s.cwd, "worktree", "add", "-q", "--detach", stale);
	rmSync(stale, { recursive: true, force: true });
	settings(s, { keep: 1 });
	const a = await saved(s);
	await s.threads.unload(a.thread.id);
	await saved(s);
	await expect.poll(() => existsSync(a.path), { timeout: 15_000 }).toBe(false);
	const list = sh(s.cwd, "worktree", "list", "--porcelain");
	expect(list).toContain(own.replace(/\\/g, "/"));
	expect(list).toContain(stale.replace(/\\/g, "/"));
});

test("a manifest whose path became another repository's worktree is notManaged and nothing is removed", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	await s.threads.unload(thread.id);
	sh(s.cwd, "worktree", "remove", "--force", path);
	const other = tempDir("kc-other-");
	makeRepo(other);
	sh(other, "worktree", "add", "-q", "--detach", path);
	expect((await archive(s, thread.id)).worktree).toEqual({ deleted: false, reason: "notManaged" });
	expect(existsSync(join(path, "a.txt"))).toBe(true);
});

test("a malformed manifest makes the thread local and removes nothing", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	await s.threads.unload(thread.id);
	writeFileSync(join(dirname(path), "worktree.json"), "{ not json");
	const read = await s.a.client.request("thread/read", { threadId: thread.id });
	expect(read.thread).toMatchObject({ workspaceMode: "local" });
	expect((await archive(s, thread.id)).worktree).toBeUndefined();
	expect(existsSync(path)).toBe(true);
});

test("nested repositories are never deleted: archive skips, worktree/delete refuses, their work stays", async () => {
	const kinds = ["submodule", "rm-cached", "never-added", "init-inside", "ignored"] as const;
	for (const kind of kinds) {
		const s = await repoServer({ "inner/keep.txt": "k\n" });
		const { thread, path } = await saved(s);
		// "ignored": a repository inside an ignored directory, which the snapshot leaves out.
		const nested = join(path, kind === "init-inside" ? "inner" : kind === "ignored" ? "vendor/deep/nested" : "nested");
		if (kind === "ignored") write(path, ".gitignore", "vendor/\n");
		if (kind === "submodule" || kind === "rm-cached") {
			const library = tempDir("kc-lib-");
			makeRepo(library, { "lib.txt": "lib\n" });
			sh(path, "-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "nested");
			write(nested, "lib.txt", "edited inside\n");
			if (kind === "rm-cached") sh(path, "rm", "-q", "-f", "--cached", "nested");
		} else {
			mkdirSync(nested, { recursive: true });
			makeRepo(nested, { "own.txt": "own\n" });
		}
		const commit = sh(nested, "rev-parse", "HEAD");
		expect((await archive(s, thread.id)).worktree).toMatchObject({ deleted: false, reason: "submodules" });
		await expect(s.a.client.request("worktree/delete", { path })).rejects.toMatchObject({
			data: { reason: "submodules" },
		});
		expect(sh(nested, "rev-parse", "HEAD")).toBe(commit);
		expect(existsSync(path)).toBe(true);
	}
}, 120_000);

test("the cleanup script after a restart gets the same two paths, also for a fork from a subdirectory", async () => {
	const s = await repoServer({ "pkg/x.txt": "x\n" });
	const record = join(s.agentDir, "cleanup.txt").replace(/\\/g, "/");
	// A start in pkg/ is a thread of the pkg/ project: its environments and trust are pkg/'s.
	const pkg = join(s.cwd, "pkg");
	await s.a.client.request("environment/save", {
		cwd: pkg,
		environments: [
			{
				name: "e",
				setup: { default: `echo "$KNIGHTCODE_SOURCE_TREE_PATH|$KNIGHTCODE_WORKTREE_PATH" >> "${record}.setup"` },
				cleanup: { default: `echo "$KNIGHTCODE_SOURCE_TREE_PATH|$KNIGHTCODE_WORKTREE_PATH" >> "${record}"` },
			},
		],
	});
	await s.a.client.request("project/trust/set", { cwd: pkg, trusted: true });
	const { thread } = await worktreeThread(s, { environment: "e" }, pkg);
	await say(s, thread.id);
	const { thread: fork } = await s.a.client.request("thread/fork", {
		threadId: thread.id,
		workspace: { mode: "worktree" },
	});
	await say(s, fork.id);
	await s.threads.closeAll();
	const next = await startServer({ agentDir: s.agentDir, sessionDir: s.sessionDir });
	const b = await next.connect("desktop");
	for (const id of [thread.id, fork.id]) await b.client.request("thread/archive", { threadId: id });
	const setup = readFileSync(`${record}.setup`, "utf8").trim().split("\n").sort();
	const cleanup = readFileSync(record, "utf8").trim().split("\n").sort();
	expect(cleanup).toEqual(setup);
});

test("pruning never takes a worktree still being prepared or restored", async () => {
	const s = await repoServer();
	settings(s, { keep: 1 });
	const first = gate();
	const original = workspaceHooks.beforeInclude;
	let calls = 0;
	workspaceHooks.beforeInclude = async () => {
		if (calls++ === 0) {
			first.enter();
			await first.opened;
		}
	};
	let starting: Promise<{ path: string }> | undefined;
	try {
		starting = saved(s);
		await first.reached;
		await saved(s);
	} finally {
		first.open();
		workspaceHooks.beforeInclude = original;
	}
	const { path } = await starting!;
	expect(existsSync(path)).toBe(true);
});

/** A process whose cwd is inside the worktree: Windows cannot remove a directory that is a process's cwd. */
function holdDirectory(dir: string) {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: dir, stdio: "ignore" });
	return () =>
		new Promise<void>((resolve) => {
			child.once("exit", () => resolve());
			child.kill();
		});
}

test.skipIf(!WIN)("a held directory fails the removal; the retry finishes it without a second snapshot", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	write(path, "held.txt", "held\n");
	const release = holdDirectory(path);
	let result: Awaited<ReturnType<typeof archive>>;
	try {
		result = await archive(s, thread.id);
	} finally {
		await release();
	}
	expect(manifestOf(path).deleted).toMatchObject({ removalFailed: true, snapshot: result.worktree!.snapshot });
	await s.a.client.request("thread/unarchive", { threadId: thread.id });
	await expect(s.a.client.request("thread/resume", { threadId: thread.id })).rejects.toMatchObject({
		data: { reason: "worktreeDeleted" },
	});
	expect(await s.a.client.request("worktree/delete", { path })).toEqual({ snapshot: result.worktree!.snapshot });
	expect(snapshotRefs(s.cwd)).toHaveLength(1);
	expect(existsSync(path)).toBe(false);
	await restore(s, thread.id);
	expect(readFileSync(join(path, "held.txt"), "utf8")).toBe("held\n");
});

test.skipIf(!WIN)("a file written into the leftover of a failed removal is never deleted", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	const release = holdDirectory(path);
	try {
		await archive(s, thread.id);
	} finally {
		await release();
	}
	expect(manifestOf(path).deleted.removalFailed).toBe(true);
	write(path, "late.txt", "late work\n");
	await s.a.client.request("worktree/delete", { path });
	await s.a.waitFor("warning", (p) => String(p.message).includes("left in place"));
	expect(readFileSync(join(path, "late.txt"), "utf8")).toBe("late work\n");
	expect(snapshotRefs(s.cwd)).toHaveLength(1);
});

test("a deleted worktree's thread forks into a new worktree from its snapshot", async () => {
	for (const layout of layouts) {
		const s = await repoServer(undefined, "sessionDir" in layout ? { sessionDir: layout.sessionDir } : undefined);
		const { thread, path } = await saved(s);
		write(path, "c.txt", "c\n");
		sh(path, "add", "-A");
		sh(path, "commit", "-q", "-m", "c");
		write(path, "a.txt", "uncommitted\n");
		await archive(s, thread.id);
		await s.a.client.request("thread/unarchive", { threadId: thread.id });
		const { thread: fork } = await s.a.client.request("thread/fork", {
			threadId: thread.id,
			workspace: { mode: "worktree" },
		});
		expect(readFileSync(join(fork.cwd, "c.txt"), "utf8")).toBe("c\n");
		expect(sh(fork.cwd, "status", "--porcelain")).toBe(" M a.txt");
	}
});

test("worktree/delete of an already deleted worktree answers its snapshot, and restore still works", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	const { worktree } = await archive(s, thread.id);
	expect(await s.a.client.request("worktree/delete", { path })).toEqual({ snapshot: worktree!.snapshot });
	await s.a.client.request("thread/unarchive", { threadId: thread.id });
	await restore(s, thread.id);
	expect(existsSync(join(path, "a.txt"))).toBe(true);
});

test("a handoff back to a deleted worktree restores it first", async () => {
	const s = await repoServer();
	const { thread, path } = await saved(s);
	await s.a.client.request("thread/handoff", { threadId: thread.id, to: "local" });
	await s.a.client.request("worktree/delete", { path });
	expect(existsSync(path)).toBe(false);
	write(s.cwd, "a.txt", "local edit\n");
	const back = await s.a.client.request("thread/handoff", { threadId: thread.id, to: "worktree" });
	expect(back.thread.cwd).toBe(path);
	expect(readFileSync(join(path, "a.txt"), "utf8")).toBe("local edit\n");
});
