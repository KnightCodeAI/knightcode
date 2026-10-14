import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import type { Item } from "@knightcode/app-server-protocol";
import { afterEach, expect, test, vi } from "vitest";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer, type TestClient } from "./harness.ts";

afterEach(cleanupServers);
const userItems = (a: TestClient) =>
	a.notifications
		.filter((n) => n.method === "item/completed")
		.map((n) => n.params.item as Item)
		.filter((i) => i.type === "userMessage");

const heldServer = async () => {
	const held = createHeldTurn();
	const server = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	return { held, ...server };
};
const turnIdOf = (p: Record<string, unknown>) => (p.turn as { id: string }).id;

test("a steer or interrupt naming a turn that is no longer running answers turnMismatch", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxText("one")]),
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("two")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	const first = turnIdOf(await a.waitFor("turn/started"));
	await a.waitFor("turn/completed");
	await a.client.request("turn/start", { threadId: thread.id, text: "second" });
	await held.entered;
	await expect(
		a.client.request("turn/steer", { threadId: thread.id, expectedTurnId: first, text: "late" }),
	).rejects.toMatchObject({ code: "turnMismatch" });
	await expect(a.client.request("turn/interrupt", { threadId: thread.id, turnId: first })).rejects.toMatchObject({
		code: "turnMismatch",
	});
	held.release();
	const done = await a.waitFor("turn/completed", (p) => turnIdOf(p) !== first);
	expect((done.turn as { status: string }).status).toBe("completed");
	const turns = await a.readTurns(thread.id);
	expect(turns.flatMap((t) => t.items).some((i) => i.type === "userMessage" && i.text === "late")).toBe(false);
});

const completedTurns = (a: TestClient) => a.notifications.filter((n) => n.method === "turn/completed").length;

test("queued inputs start their own turns in order; removal before start; removed ids not reused", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("after the steer")]),
		fauxAssistantMessage([fauxText("after the first queued input")]),
		fauxAssistantMessage([fauxText("after the second queued input")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go", clientMessageId: "c-0" });
	const turnId = turnIdOf(await a.waitFor("turn/started"));
	await held.entered;
	const add = (text: string, clientMessageId: string) =>
		a.client.request("turn/queue/add", { threadId: thread.id, text, clientMessageId });
	await a.client.request("turn/steer", { threadId: thread.id, expectedTurnId: turnId, text: "same" });
	await add("same", "c-queued");
	const { queueId } = await add("dup", "c-removed");
	expect(await a.client.request("turn/queue/remove", { threadId: thread.id, queueId })).toEqual({ removed: true });
	await add("dup", "c-kept");
	held.release();
	await a.waitFor("turn/completed", () => completedTurns(a) === 3);
	expect(userItems(a).map((u) => [u.text, u.clientMessageId])).toEqual([
		["go", "c-0"],
		["same", undefined],
		["same", "c-queued"],
		["dup", "c-kept"],
	]);
	const turns = await a.readTurns(thread.id);
	expect(turns.map((t) => t.items.filter((i) => i.type === "userMessage").length)).toEqual([2, 1, 1]);
	expect(await a.client.request("turn/queue/remove", { threadId: thread.id, queueId })).toEqual({ removed: false });
});

test("a queued input on an idle thread starts at once; removing it after it started answers removed: false", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	const { queueId } = await a.client.request("turn/queue/add", { threadId: thread.id, text: "go" });
	await held.entered;
	expect(await a.client.request("turn/queue/remove", { threadId: thread.id, queueId })).toEqual({ removed: false });
	held.release();
	await a.waitFor("turn/completed");
});

test("interrupt drops queued inputs, which the client still has from turn/queue/updated", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" })]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await held.entered;
	const { queueId } = await a.client.request("turn/queue/add", { threadId: thread.id, text: "later" });
	expect(await a.waitFor("turn/queue/updated")).toEqual({
		threadId: thread.id,
		steering: [],
		followUp: [{ id: queueId, text: "later" }],
	});
	await a.client.request("turn/interrupt", { threadId: thread.id });
	await a.waitFor("turn/completed");
	expect(await a.waitFor("turn/queue/updated", (p) => (p.followUp as unknown[]).length === 0)).toBeDefined();
	expect(completedTurns(a)).toBe(1);
	expect(userItems(a).map((u) => u.text)).toEqual(["go"]);
});

// Resume's synchronous send commit, not handler entry, owns the initial queue snapshot.
test("resume captures live queue at send time and subsequent changes are ordered notifications", async () => {
	const { held, cwd, faux, threads, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
		fauxAssistantMessage([fauxText("queued done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	const expectedTurnId = turnIdOf(await a.waitFor("turn/started"));
	await held.entered;
	await a.client.request("turn/steer", { threadId: thread.id, expectedTurnId, text: "steer" });
	const { queueId: laterId } = await a.client.request("turn/queue/add", { threadId: thread.id, text: "later" });
	const b = await connect();
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.queue).toEqual({ steering: ["steer"], followUp: [{ id: laterId, text: "later" }] });
	await a.client.request("turn/queue/remove", { threadId: thread.id, queueId: laterId });
	expect(await b.waitFor("turn/queue/updated")).toEqual({ threadId: thread.id, steering: ["steer"], followUp: [] });
	await b.client.request("thread/unsubscribe", { threadId: thread.id });
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>((r) => {
		enter = r;
	});
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const originalResume = threads.resume.bind(threads);
	const spy = vi.spyOn(threads, "resume").mockImplementationOnce(async (...args) => {
		const result = await originalResume(...args);
		enter();
		await gate;
		return result;
	});
	try {
		const pending = b.client.request("thread/resume", { threadId: thread.id });
		await entered;
		const { queueId } = await a.client.request("turn/queue/add", { threadId: thread.id, text: "new" });
		release();
		expect((await pending).queue).toEqual({ steering: ["steer"], followUp: [{ id: queueId, text: "new" }] });
		held.release();
		await a.waitFor("turn/completed", () => completedTurns(a) === 2);
		expect((await b.client.request("thread/resume", { threadId: thread.id })).queue).toEqual({
			steering: [],
			followUp: [],
		});
	} finally {
		release();
		held.release();
		spy.mockRestore();
	}
});

test("invalid resume cursor does not expose queue or establish subscription", async () => {
	const { held, cwd, faux, threads, connect } = await heldServer();
	const a = await connect();
	const b = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await held.entered;
	try {
		await expect(b.client.request("thread/resume", { threadId: thread.id, cursor: "invalid" })).rejects.toMatchObject({
			code: "invalidCursor",
		});
		expect(threads.get(thread.id).subscribers.size).toBe(1);
	} finally {
		held.release();
	}
	await a.waitFor("turn/completed");
});
