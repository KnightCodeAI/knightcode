import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@knightcode/ai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { TURN_MARKER_TYPE } from "../../src/extensions/turn-marker.ts";
import { routedFrom, virtualModelExtension } from "./fixtures/virtual-model-extension.ts";
import { cleanupServers, startServer, type TestClient } from "./harness.ts";

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupServers();
});

type Note = TestClient["notifications"][number];
type LiveItem = {
	id: string;
	type: string;
	tool?: string;
	text?: string;
	status?: string;
	parentItemId?: string;
	output?: unknown;
};
const itemOf = (n: Note) => n.params.item as LiveItem;
const isItemEvent = (n: Note) => n.method === "item/started" || n.method === "item/completed";
const turnsCompleted = (c: TestClient) => c.notifications.filter((n) => n.method === "turn/completed");

/**
 * Item order as a client builds it (§4.2): each top-level item at the latest `index` it was given, turn by
 * turn in turn/started order, removed items dropped. Nested calls are live-only and carry no index.
 */
function clientOrder(c: TestClient): string[] {
	const turns = c.notifications
		.filter((n) => n.method === "turn/started")
		.map((n) => (n.params.turn as { id: string }).id);
	const position = new Map<string, [number, number]>();
	for (const n of c.notifications) {
		if (isItemEvent(n) && !itemOf(n).parentItemId) {
			position.set(itemOf(n).id, [turns.indexOf(n.params.turnId as string), n.params.index as number]);
		}
		if (n.method === "item/removed") position.delete(n.params.itemId as string);
	}
	return [...position].sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1]).map(([id]) => id);
}

/** The last item/completed of each top-level item: what a client shows once the turn ends. */
function completedItems(c: TestClient): Map<string, LiveItem> {
	const items = new Map<string, LiveItem>();
	for (const n of c.notifications) {
		if (n.method === "item/completed" && !itemOf(n).parentItemId) items.set(itemOf(n).id, itemOf(n));
		if (n.method === "item/removed") items.delete(n.params.itemId as string);
	}
	return items;
}

/** Live order, ids, contents, tool statuses and outputs, and turn statuses, then the same thread read back; they must agree. */
async function expectReadBackMatches(c: TestClient, threadId: string): Promise<void> {
	const turns = await c.readTurns(threadId);
	const items = turns.flatMap((t) => t.items);
	expect(clientOrder(c)).toEqual(items.map((i) => i.id));
	const live = completedItems(c);
	expect(new Set(live.keys())).toEqual(new Set(items.map((i) => i.id)));
	for (const item of items) {
		const seen = live.get(item.id)!;
		if (item.type === "toolCall") {
			expect(seen.status).toBe(item.status);
			expect(seen.output).toEqual(item.output);
		}
		if (item.type === "agentMessage" || item.type === "reasoning") expect(seen.text).toBe(item.text);
	}
	const started = c.notifications
		.filter((n) => n.method === "turn/started")
		.map((n) => (n.params.turn as { id: string }).id);
	expect(turns.map((t) => t.id)).toEqual(started);
	const statuses = turnsCompleted(c).map((n) => (n.params.turn as { status: string }).status);
	expect(turns.map((t) => t.status)).toEqual(statuses);
}

/** A promise and the function that resolves it: a gate a test opens, or a signal a hook gives. */
function signal(): { promise: Promise<void>; fire(): void } {
	let fire!: () => void;
	const promise = new Promise<void>((resolve) => (fire = resolve));
	return { promise, fire };
}

test("a turn emits its notifications in order and ends completed", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("hello there friend, how are you today")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	const done = await a.waitFor("turn/completed");
	expect((done.turn as { status: string }).status).toBe("completed");
	const sequence = a.notifications
		.filter((n) => n.method.startsWith("turn/") || n.method.startsWith("item/"))
		.map((n) => (n.method.startsWith("item/") && "item" in n.params ? `${n.method}:${itemOf(n).type}` : n.method));
	expect(sequence.slice(0, 4)).toEqual([
		"turn/started",
		"item/started:userMessage",
		"item/completed:userMessage",
		"item/started:agentMessage",
	]);
	expect(sequence.indexOf("item/agentMessage/delta")).toBe(4);
	expect(sequence.at(-2)).toBe("item/completed:agentMessage");
	expect(sequence.at(-1)).toBe("turn/completed");
	await expectReadBackMatches(a, thread.id);
});

test("live ids equal read-back ids: tool call, thinking, a second message, and a steer sent mid-turn", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 40 });
	const a = await connect();
	writeFileSync(join(cwd, "a.txt"), "hello world\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage(
			[
				fauxThinking("plan the edit carefully"),
				fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([fauxText("edited, and noted your steer")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "edit it" });
	await a.waitFor("turn/started");
	await a.client.request("turn/steer", { threadId: thread.id, text: "also keep it short" });
	await a.waitFor("turn/completed");
	const userItems = a.notifications.filter((n) => n.method === "item/completed" && itemOf(n).type === "userMessage");
	expect(userItems).toHaveLength(2);
	expect(turnsCompleted(a)).toHaveLength(1);
	const edited = a.notifications.find((n) => n.method === "item/completed" && itemOf(n).type === "toolCall");
	expect(edited?.params.item).toMatchObject({ fileChanges: [{ path: "a.txt", kind: "modify" }] });
	await expectReadBackMatches(a, thread.id);
});

test("a reply whose text follows its tool call is ordered call first, live and read back", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 40 });
	const a = await connect();
	writeFileSync(join(cwd, "b.txt"), "b\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" }), fauxText("reading it now, then I will answer")], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "read b" });
	await a.waitFor("turn/completed");
	const turns = await a.readTurns(thread.id);
	expect(turns[0].items.map((i) => i.type)).toEqual(["userMessage", "toolCall", "agentMessage", "agentMessage"]);
	// The text streamed before the call existed; its final index moved it after the call.
	const text = turns[0].items[2];
	const indexes = a.notifications.filter((n) => isItemEvent(n) && itemOf(n).id === text.id).map((n) => n.params.index);
	expect(indexes.at(-1)).toBe(2);
	await expectReadBackMatches(a, thread.id);
});

test("a message_end handler that replaces a tool result changes the live completion to the saved result", async () => {
	const redact = (knightcode: ExtensionAPI) => {
		knightcode.on("message_end", (event) =>
			event.message.role === "toolResult"
				? { message: { ...event.message, content: [{ type: "text" as const, text: "[redacted]" }] } }
				: undefined,
		);
	};
	const { cwd, faux, connect } = await startServer({ extraExtensions: [{ name: "redact", factory: redact }] });
	const a = await connect();
	writeFileSync(join(cwd, "b.txt"), "secret\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "read b" });
	await a.waitFor("turn/completed");
	const call = [...completedItems(a).values()].find((i) => i.type === "toolCall")!;
	expect(call.output).toEqual([{ type: "text", text: "[redacted]" }]);
	await expectReadBackMatches(a, thread.id);
});

test("an automatic retry and a follow-up stay inside one turn", async () => {
	const { cwd, faux, agentDir, connect } = await startServer({ tokensPerSecond: 40 });
	// The retry settings and retryable error text of test/suite/agent-session-retry-events.test.ts.
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } }),
	);
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
		fauxAssistantMessage([fauxText("recovered after the retry")]),
		fauxAssistantMessage([fauxText("and the follow-up")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.client.request("turn/followUp", { threadId: thread.id, text: "then this" });
	await a.waitFor("turn/completed");
	expect(a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(1);
	expect(a.notifications.some((n) => n.method === "turn/retry")).toBe(true);
	await expectReadBackMatches(a, thread.id);
});

test("ids still match with the turn-marker built-in disabled", async () => {
	const { cwd, faux, connect } = await startServer({ disabledBuiltinExtensions: ["turn-marker"] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
});

test("ids still match when another extension appends an entry at agent_start", async () => {
	const appender = (knightcode: ExtensionAPI) => {
		knightcode.on("agent_start", () => knightcode.appendEntry("other.marker"));
	};
	const { cwd, faux, connect } = await startServer({ extraExtensions: [{ name: "appender", factory: appender }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
});

test("two concurrent turn/starts: one runs, the other answers turnInProgress; interrupt ends it interrupted", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 20 });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("a".repeat(400))])]);
	const results = await Promise.allSettled([
		a.client.request("turn/start", { threadId: thread.id, text: "one" }),
		a.client.request("turn/start", { threadId: thread.id, text: "two" }),
	]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "turnInProgress" } });
	await a.client.request("turn/interrupt", { threadId: thread.id });
	const done = await a.waitFor("turn/completed");
	expect((done.turn as { status: string }).status).toBe("interrupted");
	await expectReadBackMatches(a, thread.id);
});

test("a marker without an end entry reads back interrupted (the process died mid-turn)", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendCustomEntry(TURN_MARKER_TYPE);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "go" }], timestamp: 1 });
	const id = manager.getSessionId();
	manager.close();
	const a = await connect();
	const { turns } = await a.client.request("thread/read", { threadId: id });
	expect(turns.map((t) => t.status)).toEqual(["interrupted"]);
});

test("thread/resume during a streaming reply returns the partial text, and the deltas that follow complete it", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 30 });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const final = "word ".repeat(60).trim();
	faux.setResponses([fauxAssistantMessage([fauxText(final)])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "talk" });
	await a.waitFor("item/agentMessage/delta");
	const b = await connect();
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.runningTurn).toBeDefined();
	const running = await b.client.resolveTurn(resumed.runningTurn!);
	expect(resumed.turns.some((turn) => turn.id === running.id)).toBe(false);
	expect(running.status).toBe("inProgress");
	const partial = running.items.find((i) => i.type === "agentMessage") as { id: string; text: string };
	await b.waitFor("turn/completed");
	const after = b.notifications
		.filter((n) => n.method === "item/agentMessage/delta" && n.params.itemId === partial.id)
		.map((n) => n.params.delta as string)
		.join("");
	expect(partial.text + after).toBe(final);
});

test("two threads in two cwds run concurrently; turn and item notifications reach only their subscribers", async () => {
	const first = await startServer();
	const a = await first.connect();
	const b = await first.connect();
	const otherCwd = mkdtempSync(join(tmpdir(), "knightcode-as-cwd2-"));
	const { thread: ta } = await a.client.request("thread/start", { cwd: first.cwd });
	const { thread: tb } = await b.client.request("thread/start", { cwd: otherCwd });
	first.faux.setResponses([fauxAssistantMessage([fauxText("for a")]), fauxAssistantMessage([fauxText("for b")])]);
	await Promise.all([
		a.client.request("turn/start", { threadId: ta.id, text: "a" }),
		b.client.request("turn/start", { threadId: tb.id, text: "b" }),
	]);
	await Promise.all([a.waitFor("turn/completed"), b.waitFor("turn/completed")]);
	const threadIds = (c: TestClient) =>
		new Set(c.notifications.filter((n) => n.method.startsWith("item/")).map((n) => n.params.threadId));
	expect(threadIds(a)).toEqual(new Set([ta.id]));
	expect(threadIds(b)).toEqual(new Set([tb.id]));
	// Sidebar notifications reach everyone.
	expect(a.notifications.some((n) => n.method === "thread/status/changed" && n.params.threadId === tb.id)).toBe(true);
	await first.threads.unload(tb.id);
	await rm(otherCwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("two threads using one extension's virtual model each route with their own session", async () => {
	let target = { provider: "", id: "" };
	const routed = await startServer({
		extraExtensions: [{ name: "virt", factory: virtualModelExtension(() => target) }],
	});
	// Factories run when a thread loads, after this; the router reads the target per request.
	target = { provider: routed.faux.provider.id, id: routed.faux.getModel().id };
	const a = await routed.connect();
	const { thread: ta } = await a.client.request("thread/start", {
		cwd: routed.cwd,
		model: { provider: "virt", id: "auto" },
	});
	const { thread: tb } = await a.client.request("thread/start", {
		cwd: routed.cwd,
		model: { provider: "virt", id: "auto" },
	});
	routedFrom.length = 0;
	routed.faux.setResponses([
		fauxAssistantMessage([fauxText("a")]),
		fauxAssistantMessage([fauxText("b")]),
		fauxAssistantMessage([fauxText("a2")]),
	]);
	await a.client.request("turn/start", { threadId: ta.id, text: "a" });
	await a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === ta.id);
	await a.client.request("turn/start", { threadId: tb.id, text: "b" });
	await a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === tb.id);
	await routed.threads.unload(tb.id);
	await a.client.request("turn/start", { threadId: ta.id, text: "a again" });
	await a.waitFor("turn/completed", () => turnsCompleted(a).length === 3);
	expect(routedFrom).toEqual([ta.id, tb.id, ta.id]);
});

test("calls in one reply keep block order, and an unexecuted call exists on both paths", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(cwd, "b.txt"), "b\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		// write then read in one reply; if the agent runs them in parallel, read finishes first.
		fauxAssistantMessage(
			[fauxToolCall("write", { path: "a.txt", content: "a" }), fauxToolCall("read", { path: "b.txt" })],
			{
				stopReason: "toolUse",
			},
		),
		// A reply that fails while carrying a call: the call never runs.
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo never" })], {
			stopReason: "error",
			errorMessage: "boom",
		}),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
	const never = [...completedItems(a).values()].find((i) => i.tool === "bash");
	expect(never?.status).toBe("failed");
});

test("an idle compaction after unload and resume gets the same id and index live and read back", async () => {
	const { cwd, faux, threads, agentDir, connect } = await startServer();
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxText("one")]),
		fauxAssistantMessage([fauxText("summary one")]),
		fauxAssistantMessage([fauxText("summary two")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await a.client.request("thread/compact", { threadId: thread.id });
	await threads.unload(thread.id);
	const b = await connect();
	await b.client.request("thread/resume", { threadId: thread.id });
	// A second compaction requires new context; idle extension messages still belong to the last turn.
	await threads
		.get(thread.id)
		.session.sendCustomMessage({ customType: "note", content: "New context to summarize.", display: true });
	await threads
		.get(thread.id)
		.session.sendCustomMessage({ customType: "note", content: "Keep this recent context.", display: true });
	await b.client.request("thread/compact", { threadId: thread.id });
	const live = await b.waitFor("item/completed", (p) => (p.item as { type: string }).type === "compaction");
	const turns = await b.readTurns(thread.id);
	const items = turns.at(-1)!.items;
	const compactions = items.filter((i) => i.type === "compaction").map((i) => i.id);
	expect(compactions).toHaveLength(2);
	expect((live.item as { id: string }).id).toBe(compactions[1]);
	expect(live.index).toBe(items.findIndex((i) => i.id === compactions[1]));
});

test("turn/interrupt while a start waits in an input hook stops it before it launches a run", async () => {
	const inHook = signal();
	const gate = signal();
	// An async input hook keeps the prompt in preflight while the session still reads idle.
	const holdInput = (knightcode: ExtensionAPI) => {
		knightcode.on("input", async () => {
			inHook.fire();
			await gate.promise;
			return { action: "continue" as const };
		});
	};
	const { cwd, faux, threads, connect } = await startServer({
		extraExtensions: [{ name: "hold", factory: holdInput }],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await inHook.promise;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	gate.fire();
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id, requestId: expect.any(String) });
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	expect(threads.get(thread.id).session.isIdle).toBe(true);
	expect(faux.getPendingResponseCount()).toBe(1);
});

test("turn/interrupt during the auth check stops the start, whatever the check returns", async () => {
	const { cwd, faux, ctx, threads, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const inCheck = signal();
	const gate = signal();
	// Stubbed: the faux provider is configured, so the real check never awaits. The stub awaits, and
	// then reports no auth, which would answer authRequired if the start were not cancelled.
	vi.spyOn(ctx.models, "hasConfiguredAuth").mockReturnValue(false);
	vi.spyOn(ctx.models, "checkAuth").mockImplementation(async () => {
		inCheck.fire();
		await gate.promise;
		return undefined;
	});
	faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await inCheck.promise;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	gate.fire();
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id, requestId: expect.any(String) });
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	expect(threads.get(thread.id).session.isIdle).toBe(true);
});

test("turn/interrupt while an extension command runs stops the prompt the command dispatches", async () => {
	const inCommand = signal();
	const gate = signal();
	// The shape of /plan <task>: a command that, after some work, dispatches its task as a prompt.
	const later = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("later", {
			description: "Dispatch a prompt after a wait",
			handler: async (_args, ctx) => {
				inCommand.fire();
				await gate.promise;
				await ctx.sendUserMessage("from the command");
			},
		});
	const { cwd, faux, threads, connect } = await startServer({ extraExtensions: [{ name: "later", factory: later }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "/later" });
	await inCommand.promise;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	gate.fire();
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id, requestId: expect.any(String) });
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	expect(threads.get(thread.id).session.isIdle).toBe(true);
	expect(faux.getPendingResponseCount()).toBe(1);
});

test("thread/settings/update during a running turn applies without waiting for idle", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 20 });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("a".repeat(200))])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "slow" });
	const { thread: updated } = await a.client.request("thread/settings/update", {
		threadId: thread.id,
		thinkingLevel: "high",
	});
	expect(updated.thinkingLevel).toBe("high");
	expect(a.notifications.some((n) => n.method === "turn/completed")).toBe(false);
	await a.waitFor("turn/completed");
});

test("an extension streaming its session's virtual model directly routes with that session", async () => {
	let target = { provider: "", id: "" };
	const direct = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("direct", {
			description: "Stream the virtual model outside the agent loop",
			handler: async (_args, ctx) => {
				const model = ctx.modelRegistry.find("virt", "auto")!;
				await ctx.modelRegistry.streamSimple(model, { messages: [] }).result();
			},
		});
	const routed = await startServer({
		extraExtensions: [
			{ name: "virt", factory: virtualModelExtension(() => target) },
			{ name: "direct", factory: direct },
		],
	});
	target = { provider: routed.faux.provider.id, id: routed.faux.getModel().id };
	const a = await routed.connect();
	const { thread } = await a.client.request("thread/start", { cwd: routed.cwd });
	routedFrom.length = 0;
	routed.faux.setResponses([fauxAssistantMessage([fauxText("direct reply")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/direct" });
	expect(routedFrom).toEqual([thread.id]);
});

test("a model change reaches the subscriber as thread/settings/updated", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	await a.client.request("thread/settings/update", {
		threadId: thread.id,
		model: { provider: faux.provider.id, id: faux.getModel().id },
	});
	await a.waitFor("thread/settings/updated");
});

test("thread/fork at an item copies the branch up to that item into a new thread", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	await a.waitFor("turn/completed");
	await a.client.request("turn/start", { threadId: thread.id, text: "second" });
	await a.waitFor("turn/completed", () => turnsCompleted(a).length === 2);
	const turns = await a.readTurns(thread.id);
	const firstReply = turns[0].items.find((i) => i.type === "agentMessage")!;
	const { thread: forked } = await a.client.request("thread/fork", { threadId: thread.id, atItemId: firstReply.id });
	expect(forked.id).not.toBe(thread.id);
	const read = await a.client.request("thread/read", { threadId: forked.id });
	expect(read.turns).toHaveLength(1);
});
