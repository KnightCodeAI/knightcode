import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffFile, DiffScope } from "@knightcode/app-server-protocol";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { readFile } from "../../src/app-server/files.ts";
import { sh, write } from "./fixtures/git-repo.ts";
import { type RepoServer, repoServer, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers } from "./harness.ts";

afterEach(cleanupServers);

async function localThread(s: RepoServer, approvalMode?: "fullAccess") {
	return (await s.a.client.request("thread/start", { cwd: s.cwd, ...(approvalMode ? { approvalMode } : {}) })).thread;
}

const fileRead = (s: RepoServer, threadId: string, path: string, maxBytes?: number) =>
	s.a.client.request("file/read", { threadId, path, ...(maxBytes ? { maxBytes } : {}) });

test("file/read resolves a relative path against the thread's cwd and reads an absolute one", async () => {
	const s = await repoServer({ "src/a.ts": "export const a = 1;\n" });
	const thread = await localThread(s);
	const relative = await fileRead(s, thread.id, "src/a.ts");
	expect(relative).toEqual({
		path: join(s.cwd, "src", "a.ts"),
		size: 20,
		binary: false,
		tooLarge: false,
		text: "export const a = 1;\n",
	});
	expect(await fileRead(s, thread.id, relative.path)).toEqual(relative);
});

test("file/read refuses a directory and a missing file; a NUL makes it binary; one byte over is tooLarge", async () => {
	const s = await repoServer();
	const thread = await localThread(s);
	mkdirSync(join(s.cwd, "dir"));
	await expect(fileRead(s, thread.id, "dir")).rejects.toMatchObject({ code: "invalidParams" });
	await expect(fileRead(s, thread.id, "missing.txt")).rejects.toMatchObject({ code: "invalidParams" });
	writeFileSync(join(s.cwd, "bin.dat"), Buffer.concat([Buffer.alloc(8 * 1024 - 1, 0x61), Buffer.from([0])]));
	expect(await fileRead(s, thread.id, "bin.dat")).toEqual({
		path: join(s.cwd, "bin.dat"),
		size: 8 * 1024,
		binary: true,
		tooLarge: false,
	});
	// A NUL past the first 8 KiB is text, as git sees it.
	writeFileSync(join(s.cwd, "late.dat"), Buffer.concat([Buffer.alloc(8 * 1024, 0x61), Buffer.from([0])]));
	expect(await fileRead(s, thread.id, "late.dat")).toMatchObject({ binary: false });
	write(s.cwd, "ten.txt", "0123456789");
	expect(await fileRead(s, thread.id, "ten.txt", 10)).toMatchObject({ tooLarge: false, text: "0123456789" });
	expect(await fileRead(s, thread.id, "ten.txt", 9)).toEqual({
		path: join(s.cwd, "ten.txt"),
		size: 10,
		binary: false,
		tooLarge: true,
	});
});

test("file/read decodes invalid UTF-8 with replacement characters", async () => {
	const s = await repoServer();
	const thread = await localThread(s);
	writeFileSync(join(s.cwd, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
	expect((await fileRead(s, thread.id, "latin1.txt")).text).toBe("caf�\n");
});

/** The new side, rebuilt from the old one and the read's hunks: what an expanded diff shows. */
function applyHunks(old: string, file: DiffFile): string {
	const lines = old === "" ? [] : old.replace(/\n$/, "").split("\n");
	const out: string[] = [];
	let at = 0;
	for (const hunk of file.hunks) {
		const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
		while (at < start) out.push(lines[at++]!);
		for (const line of hunk.lines) {
			if (line.startsWith(" ")) out.push(lines[at++]!);
			else if (line.startsWith("-")) at++;
			else if (line.startsWith("+")) out.push(line.slice(1));
		}
	}
	while (at < lines.length) out.push(lines[at++]!);
	return out.length ? `${out.join("\n")}\n` : "";
}

const ten = (changes: Record<number, string> = {}) =>
	`${Array.from({ length: 10 }, (_, i) => changes[i + 1] ?? `line ${i + 1}`).join("\n")}\n`;

async function sidesOf(s: RepoServer, threadId: string, scope: DiffScope, extra: object = {}) {
	const read = await s.a.client.request("thread/diff/read", { threadId, scope, ...extra });
	expect(read.fromTree).toBeDefined();
	return Promise.all(
		read.files.map(async (file) => ({
			file,
			sides: await s.a.client.request("thread/diff/file", {
				threadId,
				fromTree: read.fromTree!,
				toTree: read.toTree!,
				path: file.path,
				...(file.oldPath ? { oldPath: file.oldPath } : {}),
			}),
		})),
	);
}

function expectConsistent(results: Awaited<ReturnType<typeof sidesOf>>) {
	expect(results.length).toBeGreaterThan(0);
	for (const { file, sides } of results) {
		expect(sides).toMatchObject({ binary: false, tooLarge: false });
		if (file.status === "added") expect(sides.old).toBeUndefined();
		if (file.status === "deleted") expect(sides.new).toBeUndefined();
		expect(applyHunks(sides.old ?? "", file)).toBe(sides.new ?? "");
	}
}

test("thread/diff/file gives each scope's sides, and the read's hunks turn its old side into its new one", async () => {
	const s = await repoServer({ "a.txt": ten(), "b.txt": ten(), "gone.txt": "bye\n" });
	const base = sh(s.cwd, "rev-parse", "HEAD");
	write(s.cwd, "a.txt", ten({ 2: "two", 9: "nine" }));
	sh(s.cwd, "commit", "-q", "-am", "edit a");
	const commit = sh(s.cwd, "rev-parse", "HEAD");
	write(s.cwd, "b.txt", ten({ 5: "five" }));
	sh(s.cwd, "add", "b.txt");
	write(s.cwd, "b.txt", ten({ 5: "five", 10: "ten" }));
	write(s.cwd, "new.txt", "brand\nnew\n");
	sh(s.cwd, "rm", "-q", "gone.txt");
	const thread = await localThread(s);
	for (const scope of ["uncommitted", "unstaged", "staged"] as const)
		expectConsistent(await sidesOf(s, thread.id, scope));
	expectConsistent(await sidesOf(s, thread.id, "committed", { commit }));
	expectConsistent(await sidesOf(s, thread.id, "branch", { against: base }));
	// Whitespace-blind hunks would not turn one side into the other, so that read names no trees.
	const blind = await s.a.client.request("thread/diff/read", { threadId: thread.id, ignoreWhitespace: true });
	expect(blind.files.length).toBeGreaterThan(0);
	expect(blind).not.toHaveProperty("fromTree");
	expect(blind).not.toHaveProperty("toTree");
});

test("thread/diff/file gives the last turn's sides", async () => {
	const s = await repoServer({ "a.txt": ten() });
	const thread = await localThread(s, "fullAccess");
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "sed -i 's/line 4/four/' a.txt && echo x > t.txt" })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await s.a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await s.a.waitFor("turn/diff/updated");
	expectConsistent(await sidesOf(s, thread.id, "lastTurn"));
});

test("a rename reads its old path; an edit on disk after the read does not change the read's sides", async () => {
	const s = await repoServer({ "a.txt": ten() });
	sh(s.cwd, "mv", "a.txt", "b.txt");
	write(s.cwd, "b.txt", ten({ 3: "three" }));
	const thread = await localThread(s);
	const read = await s.a.client.request("thread/diff/read", { threadId: thread.id });
	const file = read.files.find((f) => f.path === "b.txt")!;
	expect(file).toMatchObject({ status: "renamed", oldPath: "a.txt" });
	write(s.cwd, "b.txt", "rewritten since\n");
	const sides = await s.a.client.request("thread/diff/file", {
		threadId: thread.id,
		fromTree: read.fromTree!,
		toTree: read.toTree!,
		path: "b.txt",
		oldPath: "a.txt",
	});
	expect(sides).toEqual({ old: ten(), new: ten({ 3: "three" }), binary: false, tooLarge: false });
});

test("thread/diff/file refuses a tree the repository lacks, a ref, and a path in neither tree", async () => {
	const s = await repoServer();
	write(s.cwd, "a.txt", "edited\n");
	const thread = await localThread(s);
	const read = await s.a.client.request("thread/diff/read", { threadId: thread.id });
	const ask = (fromTree: string, toTree: string, path = "a.txt") =>
		s.a.client.request("thread/diff/file", { threadId: thread.id, fromTree, toTree, path });
	await expect(ask("0".repeat(40), read.toTree!)).rejects.toMatchObject({ code: "invalidParams" });
	await expect(ask("HEAD", read.toTree!)).rejects.toMatchObject({ code: "invalidParams" });
	await expect(ask(read.fromTree!, "--output=x")).rejects.toMatchObject({ code: "invalidParams" });
	await expect(ask(read.fromTree!, read.toTree!, "nope.txt")).rejects.toMatchObject({ code: "invalidParams" });
});

test("thread/diff/file answers binary and tooLarge with no sides", async () => {
	const s = await repoServer({ "bin.dat": "x\n", "big.txt": "x\n" });
	writeFileSync(join(s.cwd, "bin.dat"), Buffer.from([1, 0, 2]));
	write(s.cwd, "big.txt", "y".repeat(2 * 1024 * 1024 + 1));
	const thread = await localThread(s);
	const read = await s.a.client.request("thread/diff/read", { threadId: thread.id });
	const ask = (path: string) =>
		s.a.client.request("thread/diff/file", {
			threadId: thread.id,
			fromTree: read.fromTree!,
			toTree: read.toTree!,
			path,
		});
	expect(await ask("bin.dat")).toEqual({ binary: true, tooLarge: false });
	expect(await ask("big.txt")).toEqual({ binary: false, tooLarge: true });
});

test("a worktree thread's read gives trees its own checkout can read", async () => {
	const s = await repoServer({ "a.txt": ten() });
	const { thread } = await worktreeThread(s);
	write(thread.cwd, "a.txt", ten({ 7: "seven" }));
	expectConsistent(await sidesOf(s, thread.id, "uncommitted"));
});

// chmod cannot make a file unreadable on Windows, and root reads it anyway.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"file/read of a file it may not open answers invalidParams naming the path",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "kc-file-read-"));
		try {
			const file = join(dir, "secret.txt");
			writeFileSync(file, "no\n");
			chmodSync(file, 0o000);
			await expect(readFile(dir, "secret.txt")).rejects.toMatchObject({
				code: "invalidParams",
				message: expect.stringContaining("cannot read secret.txt"),
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
