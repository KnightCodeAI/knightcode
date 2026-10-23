import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { TURN_DIFF_ENTRY, turnChangeHooks } from "../../src/app-server/diff.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { write as put } from "./fixtures/git-repo.ts";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { type RepoServer, repoServer } from "./fixtures/worktree-server.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

const write = (command: string) => [
	fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxText("done")]),
];

async function fullAccess(s: RepoServer) {
	return (await s.a.client.request("thread/start", { cwd: s.cwd, approvalMode: "fullAccess" })).thread;
}

async function turn(s: RepoServer, threadId: string, text = "go") {
	await s.a.client.request("turn/start", { threadId, text });
	return (await s.a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === threadId)).turn as {
		id: string;
	};
}

const entries = (s: RepoServer, threadId: string) =>
	s.threads
		.get(threadId)
		.session.sessionManager.getBranch()
		.flatMap((e) =>
			e.type === "custom" && e.customType === TURN_DIFF_ENTRY ? [e.data as { files: { path: string }[] }] : [],
		);

test("a bash write emits turn/diff/updated after turn/completed; the user's index is unchanged", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	const index = readFileSync(join(s.cwd, ".git", "index"));
	s.faux.setResponses(write("echo hi > out.txt"));
	const completed = await turn(s, thread.id, "write");
	const diff = await s.a.waitFor("turn/diff/updated");
	expect(diff).toEqual({
		threadId: thread.id,
		turnId: completed.id,
		files: [{ path: "out.txt", additions: 1, deletions: 0 }],
	});
	const order = s.a.notifications.map((n) => n.method);
	expect(order.indexOf("turn/diff/updated")).toBeGreaterThan(order.indexOf("turn/completed"));
	expect(readFileSync(join(s.cwd, ".git", "index")).equals(index)).toBe(true);
});

test("a second edit to an already modified file is a second event", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	s.faux.setResponses(write("echo first > a.txt"));
	await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	s.faux.setResponses(write("echo second > a.txt"));
	const second = await turn(s, thread.id);
	expect(await s.a.waitFor("turn/diff/updated")).toMatchObject({
		turnId: second.id,
		files: [{ path: "a.txt", additions: 1, deletions: 1 }],
	});
});

test("a turn's totals are net: a file written then trimmed counts once, and read back on the turn", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "printf 'a\\nb\\nc\\n' > n.txt" })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxToolCall("bash", { command: "printf 'a\\nb\\n' > n.txt" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	const done = await turn(s, thread.id);
	const files = [{ path: "n.txt", additions: 2, deletions: 0 }];
	expect(await s.a.waitFor("turn/diff/updated")).toMatchObject({ turnId: done.id, files });
	const { turns } = await s.a.client.request("thread/read", { threadId: thread.id });
	expect(turns.find((t) => t.id === done.id)).toMatchObject({ files });
});

test("a text-only turn then a writing turn: one event and one record, for the second turn", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	s.faux.setResponses([fauxAssistantMessage([fauxText("just talking")])]);
	await turn(s, thread.id);
	s.faux.setResponses(write("echo x > x.txt"));
	const second = await turn(s, thread.id);
	expect(await s.a.waitFor("turn/diff/updated")).toMatchObject({ turnId: second.id });
	expect(s.a.notifications.filter((n) => n.method === "turn/diff/updated")).toHaveLength(1);
	expect(entries(s, thread.id)).toHaveLength(1);
});

const untracked = (s: RepoServer, folders: string[], each: number) => {
	for (const folder of folders) for (let i = 0; i < each; i++) put(s.cwd, `${folder}/${i}.txt`, String(i));
};

test("a file written beside a folder of 200 or more untracked files is recorded, the folder is not", async () => {
	const s = await repoServer();
	untracked(s, ["frames"], 501);
	const thread = await fullAccess(s);
	s.faux.setResponses(write("echo hi > out.txt"));
	await turn(s, thread.id);
	expect((await s.a.waitFor("turn/diff/updated")).files).toEqual([{ path: "out.txt", additions: 1, deletions: 0 }]);
});

test("files a turn deletes from a skipped folder do not leave the rest reading as added", async () => {
	const s = await repoServer();
	untracked(s, ["frames", "dataset"], 251);
	const thread = await fullAccess(s);
	// Leaves 140 files in frames: under the 200 that skipped the folder before the turn.
	s.faux.setResponses(write("rm frames/1*.txt && echo hi > out.txt"));
	await turn(s, thread.id);
	expect((await s.a.waitFor("turn/diff/updated")).files).toEqual([{ path: "out.txt", additions: 1, deletions: 0 }]);
});

test("more than 500 untracked files outside large folders: the turn records tracked files only", async () => {
	const s = await repoServer();
	untracked(s, ["one", "two", "three"], 167);
	const thread = await fullAccess(s);
	s.faux.setResponses(write("echo edited > a.txt && echo hi > out.txt"));
	await turn(s, thread.id);
	expect((await s.a.waitFor("turn/diff/updated")).files).toEqual([{ path: "a.txt", additions: 1, deletions: 3 }]);
});

test("a large folder the turn makes is left out too, so its other new file is recorded", async () => {
	const s = await repoServer();
	// 551 untracked: frames is skipped, the 300 others count.
	untracked(s, ["frames"], 251);
	untracked(s, ["one", "two"], 150);
	const thread = await fullAccess(s);
	s.faux.setResponses(
		write("mkdir deps && for i in $(seq 1 250); do echo $i > deps/$i.txt; done && echo hi > out.txt"),
	);
	await turn(s, thread.id);
	expect((await s.a.waitFor("turn/diff/updated")).files).toEqual([{ path: "out.txt", additions: 1, deletions: 0 }]);
	expect(await s.a.client.request("thread/diff/read", { threadId: thread.id, scope: "lastTurn" })).toMatchObject({
		files: [{ path: "out.txt", status: "added" }],
	});
});

test("a turn that leaves more than 500 untracked files behind still records its tracked edit", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	s.faux.setResponses(
		write("echo edited > a.txt && mkdir deps && for i in $(seq 1 501); do echo $i > deps/$i.txt; done"),
	);
	await turn(s, thread.id);
	expect((await s.a.waitFor("turn/diff/updated")).files).toEqual([{ path: "a.txt", additions: 1, deletions: 3 }]);
});

test("lastTurn reads back after unload and resume", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	s.faux.setResponses(write("echo x > x.txt"));
	const done = await turn(s, thread.id);
	await s.a.waitFor("turn/diff/updated");
	await s.threads.unload(thread.id);
	await s.a.client.request("thread/resume", { threadId: thread.id });
	const last = await s.a.client.request("thread/diff/read", { threadId: thread.id, scope: "lastTurn" });
	expect(last).toMatchObject({ scope: "lastTurn", turnId: done.id });
	expect(last.files.map((f) => [f.path, f.status])).toEqual([["x.txt", "added"]]);
});

test("a declined tool call snapshots nothing", async () => {
	const s = await repoServer();
	s.a.client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "decline" }));
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd, approvalMode: "ask" });
	s.faux.setResponses(write("echo x > x.txt"));
	// Nothing is written either way, so only the snapshot phases tell whether one ran.
	const phases: string[] = [];
	const original = turnChangeHooks.afterSnapshot;
	turnChangeHooks.afterSnapshot = async (phase) => void phases.push(phase);
	try {
		await turn(s, thread.id);
	} finally {
		turnChangeHooks.afterSnapshot = original;
	}
	expect(phases).toEqual([]);
	expect(entries(s, thread.id)).toEqual([]);
});

test("queued inputs each get their own record and event, in turn order", async () => {
	const held = createHeldTurn();
	const s = await repoServer(undefined, { extraExtensions: [{ name: "held", factory: held.extension }] });
	const thread = await fullAccess(s);
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("held")]),
		...write("echo 2 > f2.txt"),
		...write("echo 3 > f3.txt"),
		...write("echo 4 > f4.txt"),
	]);
	await s.a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	await held.entered;
	try {
		for (const n of [2, 3, 4]) await s.a.client.request("turn/queue/add", { threadId: thread.id, text: `f${n}` });
	} finally {
		held.release();
	}
	for (let i = 0; i < 3; i++) await s.a.waitFor("turn/diff/updated");
	const events = s.a.notifications
		.filter((n) => n.method === "turn/diff/updated")
		.map((n) => (n.params.files as { path: string }[]).map((f) => f.path));
	expect(events).toEqual([["f2.txt"], ["f3.txt"], ["f4.txt"]]);
	expect(entries(s, thread.id).map((e) => e.files.map((f) => f.path))).toEqual([["f2.txt"], ["f3.txt"], ["f4.txt"]]);
});

test("unloading while the after-snapshot is parked still records the turn", async () => {
	const s = await repoServer();
	const thread = await fullAccess(s);
	let release!: () => void;
	let parked!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const entered = new Promise<void>((resolve) => (parked = resolve));
	const original = turnChangeHooks.afterSnapshot;
	turnChangeHooks.afterSnapshot = async (phase) => {
		if (phase !== "after") return;
		parked();
		await gate;
	};
	try {
		s.faux.setResponses(write("echo x > x.txt"));
		await turn(s, thread.id);
		await entered;
		const unloading = s.threads.unload(thread.id);
		release();
		await unloading;
	} finally {
		turnChangeHooks.afterSnapshot = original;
		release();
	}
	await s.a.client.request("thread/resume", { threadId: thread.id });
	expect(entries(s, thread.id).map((e) => e.files.map((f) => f.path))).toEqual([["x.txt"]]);
});

test("unloading during a gated agent_settled queues the after-snapshot before the session is disposed", async () => {
	let release!: () => void;
	let parked!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const entered = new Promise<void>((resolve) => (parked = resolve));
	const order: string[] = [];
	const holdSettled = (knightcode: ExtensionAPI) => {
		knightcode.on("agent_settled", async () => {
			parked();
			await gate;
		});
		knightcode.on("session_shutdown", () => void order.push("shutdown"));
	};
	const s = await repoServer(undefined, { extraExtensions: [{ name: "hold-settled", factory: holdSettled }] });
	const thread = await fullAccess(s);
	const original = turnChangeHooks.afterSnapshot;
	turnChangeHooks.afterSnapshot = async (phase) => void order.push(phase);
	try {
		s.faux.setResponses(write("echo x > x.txt"));
		await s.a.client.request("turn/start", { threadId: thread.id, text: "go" });
		await entered;
		await s.threads.unload(thread.id);
	} finally {
		release();
		turnChangeHooks.afterSnapshot = original;
	}
	expect(order).toEqual(["before", "after", "shutdown"]);
	await s.a.client.request("thread/resume", { threadId: thread.id });
	expect(entries(s, thread.id).map((e) => e.files.map((f) => f.path))).toEqual([["x.txt"]]);
});

test("outside git there is no event, and tools still run", async () => {
	const s = await startServer();
	const a = await s.connect("desktop");
	const { thread } = await a.client.request("thread/start", { cwd: s.cwd, approvalMode: "fullAccess" });
	s.faux.setResponses(write("echo x > x.txt"));
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(readFileSync(join(s.cwd, "x.txt"), "utf8").trim()).toBe("x");
	expect(a.notifications.some((n) => n.method === "turn/diff/updated")).toBe(false);
});
