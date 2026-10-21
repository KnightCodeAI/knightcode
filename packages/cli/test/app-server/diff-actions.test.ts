import { type ChildProcess, spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import type { DiffComment, ParamsOf } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import { revertHooks, TURN_COMMENTS_ENTRY, turnChangeHooks } from "../../src/app-server/diff.ts";
import { queueHooks } from "../../src/app-server/threads.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { attachJsonlLineReader } from "../../src/modes/rpc/jsonl.ts";
import { makeRepo, sh, write } from "./fixtures/git-repo.ts";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { type RepoServer, repoServer } from "./fixtures/worktree-server.ts";
import { cleanupServers, stopChild } from "./harness.ts";

afterEach(cleanupServers);

const POSIX = process.platform !== "win32";
const seven = (changes: Record<number, string> = {}) =>
	`${[1, 2, 3, 4, 5, 6, 7].map((n) => changes[n] ?? String(n)).join("\n")}\n`;
const bashTurn = (command: string) => [
	fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxText("done")]),
];

async function local(s: RepoServer, approvalMode: "fullAccess" | "ask" = "fullAccess") {
	return (await s.a.client.request("thread/start", { cwd: s.cwd, approvalMode })).thread;
}
const read = (s: RepoServer, threadId: string, params: Omit<ParamsOf<"thread/diff/read">, "threadId"> = {}) =>
	s.a.client.request("thread/diff/read", { threadId, ...params });
const revert = (s: RepoServer, threadId: string, params: Omit<ParamsOf<"thread/diff/revert">, "threadId"> = {}) =>
	s.a.client.request("thread/diff/revert", { threadId, ...params });
async function turn(s: RepoServer, threadId: string, text = "go", extra: object = {}) {
	await s.a.client.request("turn/start", { threadId, text, ...extra });
	return (await s.a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === threadId)).turn as {
		id: string;
	};
}
const text = (s: RepoServer, path: string) => readFileSync(join(s.cwd, path), "utf8");
function gate() {
	let open!: () => void;
	let entered!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	const reached = new Promise<void>((resolve) => (entered = resolve));
	return { opened, reached, open, enter: () => entered() };
}
/**
 * Start a revert and prove it waits for the parked after-snapshot: once it holds the checkout reservation (taken
 * before the wait), open the gate; the revert's afterReserve must come after the opening.
 */
async function revertAfterGate(s: RepoServer, threadId: string, parked: ReturnType<typeof gate>): Promise<string[]> {
	const events: string[] = [];
	const original = revertHooks.afterReserve;
	revertHooks.afterReserve = async () => {
		events.push("reserved");
	};
	try {
		const reverting = revert(s, threadId, { path: "a.txt" });
		const reserved = (s.threads as unknown as { reservedCheckouts: Map<string, string> }).reservedCheckouts;
		await expect.poll(() => reserved.size, { timeout: 15_000 }).toBe(1);
		events.push("opened");
		parked.open();
		await reverting;
		return events;
	} finally {
		revertHooks.afterReserve = original;
	}
}

test("reverting one of two hunks keeps the other", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const thread = await local(s);
	write(s.cwd, "a.txt", seven({ 1: "ONE", 7: "SEVEN" }));
	const [file] = (await read(s, thread.id, { context: 1 })).files;
	expect(file.hunks).toHaveLength(2);
	expect(await revert(s, thread.id, { path: "a.txt", hunkId: file.hunks[0].id, context: 1 })).toEqual({
		paths: ["a.txt"],
	});
	expect(text(s, "a.txt")).toBe(seven({ 7: "SEVEN" }));
});

test("reverting a file restores it; reverting an untracked added file deletes it", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "changed\n");
	write(s.cwd, "new.txt", "new\n");
	await revert(s, thread.id, { path: "a.txt" });
	expect(text(s, "a.txt")).toBe("one\ntwo\nthree\n");
	await revert(s, thread.id, { path: "new.txt" });
	expect(existsSync(join(s.cwd, "new.txt"))).toBe(false);
	// Staged changes go too: nothing is left in the index for a later commit to bring back.
	write(s.cwd, "a.txt", "staged\n");
	write(s.cwd, "added.txt", "added\n");
	sh(s.cwd, "add", "a.txt", "added.txt");
	await revert(s, thread.id, { path: "a.txt" });
	await revert(s, thread.id, { path: "added.txt" });
	expect(sh(s.cwd, "status", "--porcelain")).toBe("");
});

test("a stale hunk id answers diffChanged and changes nothing", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const thread = await local(s);
	write(s.cwd, "a.txt", seven({ 2: "TWO" }));
	const [file] = (await read(s, thread.id)).files;
	write(s.cwd, "a.txt", seven({ 2: "TWO!" }));
	await expect(revert(s, thread.id, { path: "a.txt", hunkId: file.hunks[0].id })).rejects.toMatchObject({
		code: "gitConflict",
		data: { reason: "diffChanged", paths: ["a.txt"] },
	});
	expect(text(s, "a.txt")).toBe(seven({ 2: "TWO!" }));
});

test("a hunk id from a whitespace-hidden read answers diffChanged", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const thread = await local(s);
	write(s.cwd, "a.txt", seven({ 2: "TWO", 3: "  3" }));
	const [file] = (await read(s, thread.id, { ignoreWhitespace: true })).files;
	await expect(revert(s, thread.id, { path: "a.txt", hunkId: file.hunks[0].id })).rejects.toMatchObject({
		data: { reason: "diffChanged" },
	});
});

test("undoing the last turn restores its files", async () => {
	const s = await repoServer();
	const thread = await local(s);
	s.faux.setResponses(bashTurn("echo turn > a.txt && echo made > made.txt"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	expect((await revert(s, thread.id, { scope: "lastTurn" })).paths.sort()).toEqual(["a.txt", "made.txt"]);
	expect(text(s, "a.txt")).toBe("one\ntwo\nthree\n");
	expect(existsSync(join(s.cwd, "made.txt"))).toBe(false);
});

test("undo after the user replaced a turn's directory with a file, or ignored its file, is diffChanged", async () => {
	const s = await repoServer();
	const thread = await local(s);
	s.faux.setResponses(bashTurn("mkdir dir && echo made > dir/a.txt && echo log > made.log"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	rmSync(join(s.cwd, "dir"), { recursive: true });
	write(s.cwd, "dir", "a file now\n");
	await expect(revert(s, thread.id, { scope: "lastTurn", path: "dir/a.txt" })).rejects.toMatchObject({
		data: { reason: "diffChanged" },
	});
	// Ignored since the turn: compared by what is on disk, so unchanged it still undoes.
	write(s.cwd, ".gitignore", "*.log\n");
	expect((await revert(s, thread.id, { scope: "lastTurn", path: "made.log" })).paths).toEqual(["made.log"]);
	expect(existsSync(join(s.cwd, "made.log"))).toBe(false);
});

test("an undo naming a turn that is no longer the last one is diffChanged and changes nothing", async () => {
	const s = await repoServer();
	const thread = await local(s);
	s.faux.setResponses(bashTurn("echo made > made.txt"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	const { turnId } = await read(s, thread.id, { scope: "lastTurn" });
	await expect(revert(s, thread.id, { scope: "lastTurn", turnId: "an-older-turn" })).rejects.toMatchObject({
		data: { reason: "diffChanged" },
	});
	expect(existsSync(join(s.cwd, "made.txt"))).toBe(true);
	expect((await revert(s, thread.id, { scope: "lastTurn", turnId })).paths).toEqual(["made.txt"]);
});

test("after a turn that changed nothing, the last turn has no files and undo leaves the earlier turn alone", async () => {
	const s = await repoServer();
	const thread = await local(s);
	s.faux.setResponses(bashTurn("echo made > made.txt"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	s.faux.setResponses([fauxAssistantMessage([fauxText("just talk")])]);
	await turn(s, thread.id);
	expect((await read(s, thread.id, { scope: "lastTurn" })).files).toEqual([]);
	await expect(revert(s, thread.id, { scope: "lastTurn" })).rejects.toMatchObject({ code: "invalidParams" });
	expect(existsSync(join(s.cwd, "made.txt"))).toBe(true);
});

test("hunk actions on structural changes are invalidParams; the whole file reverts", async () => {
	const s = await repoServer({ "a.txt": seven(), "b.txt": seven(), "t.txt": "t\n" });
	const thread = await local(s);
	sh(s.cwd, "mv", "a.txt", "renamed.txt");
	write(s.cwd, "renamed.txt", seven({ 1: "ONE", 7: "SEVEN" }));
	if (POSIX) {
		write(s.cwd, "b.txt", seven({ 1: "ONE" }));
		chmodSync(join(s.cwd, "b.txt"), 0o755);
		unlinkSync(join(s.cwd, "t.txt"));
		symlinkSync("b.txt", join(s.cwd, "t.txt"));
	}
	const files = (await read(s, thread.id, { context: 1 })).files;
	const before = { renamed: text(s, "renamed.txt") };
	for (const file of files) {
		if (file.hunks.length === 0) continue;
		await expect(revert(s, thread.id, { path: file.path, hunkId: file.hunks[0].id, context: 1 })).rejects.toMatchObject(
			{ code: "invalidParams" },
		);
	}
	expect(text(s, "renamed.txt")).toBe(before.renamed);
	await revert(s, thread.id, { path: "renamed.txt" });
	expect(existsSync(join(s.cwd, "renamed.txt"))).toBe(false);
	expect(text(s, "a.txt")).toBe(seven());
});

test("undo after the user edited a turn's file is diffChanged, also for a repeated block moved by hand", async () => {
	const block = "x\ny\nz\n";
	const s = await repoServer({ "a.txt": `${block}---\n${block}` });
	const thread = await local(s);
	s.faux.setResponses(bashTurn("printf 'X\\ny\\nz\\n---\\nx\\ny\\nz\\n' > a.txt"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	// The user undoes the turn's edit by hand and makes the same edit in the second block.
	write(s.cwd, "a.txt", `${block}---\nX\ny\nz\n`);
	await expect(revert(s, thread.id, { scope: "lastTurn" })).rejects.toMatchObject({
		data: { reason: "diffChanged" },
	});
	expect(text(s, "a.txt")).toBe(`${block}---\nX\ny\nz\n`);
});

test("a revert while a turn runs in the checkout is turnInProgress", async () => {
	const held = createHeldTurn();
	const s = await repoServer(undefined, { extraExtensions: [{ name: "held", factory: held.extension }] });
	const thread = await local(s);
	const sibling = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await s.a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	await held.entered;
	try {
		await expect(revert(s, sibling.id, { path: "a.txt" })).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		held.release();
	}
});

test("a revert through a sibling waits for an unloading thread's parked after-snapshot", async () => {
	const s = await repoServer();
	const thread = await local(s);
	const sibling = await local(s);
	write(s.cwd, "a.txt", "user edit\n");
	const parked = gate();
	const original = turnChangeHooks.afterSnapshot;
	turnChangeHooks.afterSnapshot = async (phase) => {
		if (phase !== "after") return;
		parked.enter();
		await parked.opened;
	};
	let unloading: Promise<void> | undefined;
	try {
		s.faux.setResponses(bashTurn("echo x > x.txt"));
		await turn(s, thread.id);
		await parked.reached;
		unloading = s.threads.unload(thread.id);
		expect(await revertAfterGate(s, sibling.id, parked)).toEqual(["opened", "reserved"]);
	} finally {
		parked.open();
		turnChangeHooks.afterSnapshot = original;
	}
	await unloading;
	expect(text(s, "a.txt")).toBe("one\ntwo\nthree\n");
	await s.a.client.request("thread/resume", { threadId: thread.id });
	const last = await read(s, thread.id, { scope: "lastTurn" });
	expect(last.files.map((f) => f.path)).toEqual(["x.txt"]);
});

test("a revert right after turn/completed waits for that turn's after-snapshot", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "user edit\n");
	const parked = gate();
	const original = turnChangeHooks.afterSnapshot;
	turnChangeHooks.afterSnapshot = async (phase) => {
		if (phase !== "after") return;
		parked.enter();
		await parked.opened;
	};
	try {
		s.faux.setResponses(bashTurn("echo x > x.txt"));
		await turn(s, thread.id);
		await parked.reached;
		expect(await revertAfterGate(s, thread.id, parked)).toEqual(["opened", "reserved"]);
	} finally {
		parked.open();
		turnChangeHooks.afterSnapshot = original;
	}
	const last = await read(s, thread.id, { scope: "lastTurn" });
	expect(last.files.map((f) => f.path)).toEqual(["x.txt"]);
});

test("staged and committed scopes, and a path outside the diff, are invalidParams", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	await expect(revert(s, thread.id, { scope: "staged" })).rejects.toMatchObject({ code: "invalidParams" });
	await expect(
		revert(s, thread.id, { scope: "committed", commit: sh(s.cwd, "rev-parse", "HEAD") }),
	).rejects.toMatchObject({ code: "invalidParams" });
	await expect(revert(s, thread.id, { path: "nope.txt" })).rejects.toMatchObject({ code: "invalidParams" });
	await expect(revert(s, thread.id, { hunkId: "abc" })).rejects.toMatchObject({ code: "invalidParams" });
});

test("with core.autocrlf and CRLF working files a hunk revert round-trips", async () => {
	const s = await repoServer({ "a.txt": seven() });
	sh(s.cwd, "config", "core.autocrlf", "true");
	const crlf = (t: string) => t.replace(/\n/g, "\r\n");
	write(s.cwd, "a.txt", crlf(seven()));
	const thread = await local(s);
	write(s.cwd, "a.txt", crlf(seven({ 1: "ONE", 7: "SEVEN" })));
	const [file] = (await read(s, thread.id, { context: 1 })).files;
	await revert(s, thread.id, { path: "a.txt", hunkId: file.hunks[1].id, context: 1 });
	expect(text(s, "a.txt")).toBe(crlf(seven({ 1: "ONE" })));
});

test.skipIf(!POSIX)(
	"undo restores a created symlink and a file replaced by one; a retargeted link is diffChanged",
	async () => {
		const s = await repoServer({ "a.txt": "a\n", "t.txt": "t\n" });
		const thread = await local(s);
		s.faux.setResponses(bashTurn("ln -s t.txt link && rm a.txt && ln -s t.txt a.txt"));
		await turn(s, thread.id);
		await s.a.waitFor("turn/diff/updated");
		await revert(s, thread.id, { scope: "lastTurn" });
		expect(existsSync(join(s.cwd, "link"))).toBe(false);
		expect(text(s, "a.txt")).toBe("a\n");
		s.faux.setResponses(bashTurn("ln -s t.txt link2"));
		await turn(s, thread.id);
		await s.a.waitFor("turn/diff/updated");
		unlinkSync(join(s.cwd, "link2"));
		symlinkSync("a.txt", join(s.cwd, "link2"));
		await expect(revert(s, thread.id, { scope: "lastTurn" })).rejects.toMatchObject({
			data: { reason: "diffChanged" },
		});
	},
);

const comment = (
	c: Partial<DiffComment> & Pick<DiffComment, "path" | "side" | "startLine" | "endLine">,
): DiffComment => ({
	body: "look here",
	...c,
});

test("a comment on staged quotes the index version, not the working file", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const thread = await local(s);
	write(s.cwd, "a.txt", seven({ 2: "STAGED" }));
	sh(s.cwd, "add", "a.txt");
	write(s.cwd, "a.txt", seven({ 2: "WORKING" }));
	const seen: string[] = [];
	s.faux.setResponses([
		(context) => {
			seen.push(JSON.stringify(context.messages.at(-1)));
			return fauxAssistantMessage([fauxText("ok")]);
		},
	]);
	await turn(s, thread.id, "fix", {
		comments: [comment({ scope: "staged", path: "a.txt", side: "new", startLine: 2, endLine: 2 })],
	});
	// The user's text leads, so a title taken from the first line is theirs.
	expect(seen[0]).toContain('"text":"fix\\n\\nReview comments on the changes:');
	expect(seen[0]).toContain("STAGED");
	expect(seen[0]).not.toContain("WORKING");
	expect(seen[0]).toContain("`a.txt` line 2 (new)");
});

test("a comment on lastTurn quotes the turn's result after the user edited the file", async () => {
	const s = await repoServer();
	const thread = await local(s);
	s.faux.setResponses(bashTurn("printf 'turn line\\n' > a.txt"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	write(s.cwd, "a.txt", "user line\n");
	const seen: string[] = [];
	s.faux.setResponses([
		(context) => {
			seen.push(JSON.stringify(context.messages.at(-1)));
			return fauxAssistantMessage([fauxText("ok")]);
		},
	]);
	await turn(s, thread.id, "again", {
		comments: [comment({ scope: "lastTurn", path: "a.txt", side: "new", startLine: 1, endLine: 1 })],
	});
	expect(seen[0]).toContain("turn line");
	expect(seen[0]).not.toContain("user line");
});

test("an old-side comment on a renamed file quotes the old name's content", async () => {
	const s = await repoServer({ "old.txt": "old content\nmore\nlines\nhere\n", "new.txt": "another file\n" });
	const thread = await local(s);
	// A different file had the new name in an earlier commit.
	sh(s.cwd, "rm", "-q", "new.txt");
	sh(s.cwd, "commit", "-q", "-m", "drop the other file");
	sh(s.cwd, "mv", "old.txt", "new.txt");
	const seen: string[] = [];
	s.faux.setResponses([
		(context) => {
			seen.push(JSON.stringify(context.messages.at(-1)));
			return fauxAssistantMessage([fauxText("ok")]);
		},
	]);
	const [file] = (await read(s, thread.id)).files.filter((f) => f.path === "new.txt");
	expect(file).toMatchObject({ status: "renamed", oldPath: "old.txt" });
	await turn(s, thread.id, "rename", {
		comments: [comment({ path: "new.txt", side: "old", startLine: 1, endLine: 1 })],
	});
	expect(seen[0]).toContain("old content");
	expect(seen[0]).not.toContain("another file");
});

test("bad comments are invalidParams before anything starts", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "one\nTWO\nthree\n");
	write(s.cwd, "added.txt", "a\n");
	for (const bad of [
		comment({ path: "nope.txt", side: "new", startLine: 1, endLine: 1 }),
		comment({ path: "added.txt", side: "old", startLine: 1, endLine: 1 }),
		comment({ path: "a.txt", side: "new", startLine: 2, endLine: 1 }),
		comment({ path: "a.txt", side: "new", startLine: 1, endLine: 9 }),
	])
		await expect(
			s.a.client.request("turn/start", { threadId: thread.id, text: "x", comments: [bad] }),
		).rejects.toMatchObject({ code: "invalidParams" });
	expect(s.a.notifications.some((n) => n.method === "turn/started")).toBe(false);
});

test("the user item shows the comments and only the typed text, live and after resume", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "one\nTWO\nthree\n");
	const c = comment({ path: "a.txt", side: "new", startLine: 2, endLine: 2 });
	s.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await turn(s, thread.id, "please fix", { comments: [c] });
	const live = s.a.notifications.find(
		(n) => n.method === "item/completed" && (n.params.item as { type: string }).type === "userMessage",
	)!.params.item as { text: string; comments: DiffComment[] };
	expect(live).toMatchObject({ text: "please fix", comments: [c] });
	await s.threads.unload(thread.id);
	const turns = await s.a.readTurns(thread.id);
	expect(turns[0].items[0]).toMatchObject({ type: "userMessage", text: "please fix", comments: [c] });
});

test("a start with comments that an input handler handles records no comments", async () => {
	const handler = (knightcode: ExtensionAPI) => {
		knightcode.on("input", (event) => (event.text.includes("handle-me") ? { action: "handled" as const } : undefined));
	};
	const s = await repoServer(undefined, { extraExtensions: [{ name: "handler", factory: handler }] });
	const thread = await local(s);
	write(s.cwd, "a.txt", "one\nTWO\nthree\n");
	const c = comment({ path: "a.txt", side: "new", startLine: 2, endLine: 2 });
	expect(
		await s.a.client.request("turn/start", { threadId: thread.id, text: "handle-me", comments: [c] }),
	).toMatchObject({ status: "handled" });
	s.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await turn(s, thread.id, "plain");
	const branch = s.threads.get(thread.id).session.sessionManager.getBranch();
	expect(branch.some((e) => e.type === "custom" && e.customType === TURN_COMMENTS_ENTRY)).toBe(false);
	const turns = await s.a.readTurns(thread.id);
	expect(turns.at(-1)!.items[0]).not.toHaveProperty("comments");
});

test("a queued input keeps its comments until it runs", async () => {
	const held = createHeldTurn();
	const s = await repoServer(undefined, { extraExtensions: [{ name: "held", factory: held.extension }] });
	const thread = await local(s);
	write(s.cwd, "a.txt", "one\nTWO\nthree\n");
	const c = comment({ path: "a.txt", side: "new", startLine: 2, endLine: 2 });
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("held")]),
		fauxAssistantMessage([fauxText("queued ran")]),
	]);
	await s.a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	await held.entered;
	try {
		await s.a.client.request("turn/queue/add", { threadId: thread.id, text: "later", comments: [c] });
	} finally {
		held.release();
	}
	await s.a.waitFor("turn/completed");
	await s.a.waitFor("turn/completed");
	const turns = await s.a.readTurns(thread.id);
	expect(turns.at(-1)!.items[0]).toMatchObject({ text: "later", comments: [c] });
});

test("a revert answers turnInProgress while a dequeued input has not registered its start", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	const parked = gate();
	const original = queueHooks.afterDequeue;
	queueHooks.afterDequeue = async () => {
		parked.enter();
		await parked.opened;
	};
	try {
		s.faux.setResponses([fauxAssistantMessage([fauxText("ran")])]);
		await s.a.client.request("turn/queue/add", { threadId: thread.id, text: "queued" });
		await parked.reached;
		await expect(revert(s, thread.id, { path: "a.txt" })).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		parked.open();
		queueHooks.afterDequeue = original;
	}
	await s.a.waitFor("turn/completed");
	expect(s.a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(1);
});

test("a queued input waits while a revert holds the checkout, then runs once", async () => {
	const s = await repoServer();
	const thread = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	const parked = gate();
	const original = revertHooks.afterReserve;
	revertHooks.afterReserve = async () => {
		parked.enter();
		await parked.opened;
	};
	let reverting: Promise<unknown> | undefined;
	try {
		reverting = revert(s, thread.id, { path: "a.txt" });
		await parked.reached;
		s.faux.setResponses([fauxAssistantMessage([fauxText("ran")])]);
		await s.a.client.request("turn/queue/add", { threadId: thread.id, text: "queued" });
		await s.a.waitFor("turn/queue/updated", (p) => (p.followUp as unknown[]).length === 1);
		const b = await s.connect("desktop");
		expect((await b.client.request("thread/resume", { threadId: thread.id })).queue.followUp).toHaveLength(1);
		expect(s.a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	} finally {
		parked.open();
		revertHooks.afterReserve = original;
	}
	await reverting;
	await s.a.waitFor("turn/completed");
	expect(s.a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(1);
});

test("over real stdio, comments past the quote budget are refused and the connection lives on", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
	const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "knightcode-as-e2e-cwd-")));
	makeRepo(cwd, { "big.txt": "x\n", "many.txt": "y\n" });
	writeFileSync(join(cwd, "big.txt"), `${"z".repeat(2 * 1024 * 1024)}\n`);
	writeFileSync(join(cwd, "many.txt"), `${Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")}\n`);
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
			const timer = setTimeout(() => reject(new Error(`timed out waiting for ${id}`)), 60_000);
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
		const big = Array.from({ length: 50 }, () => comment({ path: "big.txt", side: "new", startLine: 1, endLine: 1 }));
		send({ id: 3, method: "turn/queue/add", params: { threadId, text: "x", comments: big } });
		expect((await reply(3)).error).toMatchObject({ code: "invalidParams" });
		const many = [comment({ path: "many.txt", side: "new", startLine: 1, endLine: 200 })];
		send({ id: 4, method: "turn/queue/add", params: { threadId, text: "y", comments: many } });
		expect((await reply(4)).result).toMatchObject({ queueId: expect.any(String) });
	} finally {
		await stopChild(child);
		rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}, 120_000);
