import { fauxAssistantMessage, fauxText, fauxToolCall, type AssistantMessageEvent } from "@knightcode/ai";
import type { Item } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { ItemMapper } from "../../src/app-server/item-mapper.ts";
import type { LoadedThread } from "../../src/app-server/loaded-thread.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

function fixture() {
	const notes: { method: string; params: Record<string, unknown> }[] = [];
	const manager = SessionManager.inMemory();
	const thread = {
		id: "thread",
		session: {
			sessionManager: manager,
			getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 }),
			getContextUsage: () => undefined,
		},
		waitingOn: () => [],
		payloads: { item: structuredClone, output: structuredClone, turn: structuredClone },
		notify: (method: string, params: Record<string, unknown>) =>
			notes.push({ method, params: structuredClone(params) }),
	} as unknown as LoadedThread;
	const mapper = new ItemMapper(
		thread,
		() => {},
		() => {},
	);
	mapper.handle({ type: "agent_start" });
	const partial = fauxAssistantMessage([], { stopReason: "pending" });
	mapper.handle({ type: "message_start", message: partial });
	const update = (event: AssistantMessageEvent) =>
		mapper.handle({ type: "message_update", message: partial, assistantMessageEvent: event });
	return { mapper, partial, update, notes };
}

test("streams bounded, non-executing tool previews without sending file bodies on every delta", () => {
	const { mapper, partial, update, notes } = fixture();
	const call = fauxToolCall("write", { path: "a.ts", content: "x".repeat(100_000) }, { id: "draft" });
	partial.content.push(call);
	update({ type: "toolcall_start", contentIndex: 0, partial });
	for (let i = 0; i < 20; i++) {
		call.arguments.content = `${i}${"x".repeat(100_000)}`;
		update({ type: "toolcall_delta", contentIndex: 0, delta: "x", partial });
	}
	const calls = notes.filter(
		(note) => note.method === "item/started" && (note.params.item as Item).type === "toolCall",
	);
	expect(calls).toHaveLength(1);
	expect(calls[0].params.item).toMatchObject({
		id: "draft",
		tool: "write",
		input: { path: "a.ts" },
		status: "pending",
		output: [],
	});
	expect(mapper.snapshot()?.items).toHaveLength(1);
	expect(mapper.snapshot()?.items[0]).not.toHaveProperty("fileChanges");
});

test("updates rewritten tool names and paths without duplicating the preview", () => {
	const { mapper, partial, update } = fixture();
	const call = fauxToolCall("write", { path: "old.ts", content: "draft" }, { id: "same" });
	partial.content.push(call);
	update({ type: "toolcall_start", contentIndex: 0, partial });
	call.name = "read";
	call.arguments = { path: "new.ts" };
	update({ type: "toolcall_delta", contentIndex: 0, delta: "", partial });
	expect(mapper.snapshot()?.items).toMatchObject([
		{ id: "same", tool: "read", input: { path: "new.ts" }, status: "pending" },
	]);
});

test("withdraws stale previews, preserves finalized call ids and replaces preview input with full input", () => {
	const { mapper, partial, update, notes } = fixture();
	const stale = fauxToolCall("write", { path: "stale.ts" }, { id: "stale" });
	const good = fauxToolCall("edit", { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] }, { id: "good" });
	partial.content.push(stale, good);
	update({ type: "toolcall_start", contentIndex: 0, partial });
	update({ type: "toolcall_start", contentIndex: 1, partial });
	mapper.handle({
		type: "message_end",
		message: fauxAssistantMessage([good, fauxText("Checking the edit.")], { stopReason: "toolUse" }),
	});
	expect(notes.filter((note) => note.method === "item/removed").map((note) => note.params.itemId)).toEqual(["stale"]);
	expect(mapper.snapshot()?.items.map((item) => item.id)).toEqual(["good", expect.stringMatching(/:0:1$/)]);
	expect(mapper.snapshot()?.items[0]).toMatchObject({ input: good.arguments, status: "pending" });
	mapper.handle({ type: "tool_execution_start", toolCallId: "good", toolName: "edit", args: good.arguments });
	expect(notes.at(-1)).toMatchObject({
		method: "item/started",
		params: { item: { id: "good", status: "running" }, index: 0 },
	});
});

test("removes all draft previews when a completed reply withdraws every call", () => {
	const { mapper, partial, update, notes } = fixture();
	partial.content.push(fauxToolCall("write", { path: "never.ts" }, { id: "never" }));
	update({ type: "toolcall_start", contentIndex: 0, partial });
	mapper.handle({ type: "message_end", message: fauxAssistantMessage("No tool was called.") });
	expect(notes.some((note) => note.method === "item/removed" && note.params.itemId === "never")).toBe(true);
	expect(mapper.snapshot()?.items.some((item) => item.type === "toolCall")).toBe(false);
});

test("retains running command output in resume snapshots and replaces it with the authoritative result", () => {
	const { mapper, notes } = fixture();
	const call = fauxToolCall("bash", { command: "run-check" }, { id: "command" });
	mapper.handle({ type: "message_end", message: fauxAssistantMessage([call], { stopReason: "toolUse" }) });
	mapper.handle({ type: "tool_execution_start", toolCallId: "command", toolName: "bash", args: call.arguments });
	mapper.handle({
		type: "tool_execution_update",
		toolCallId: "command",
		toolName: "bash",
		args: call.arguments,
		partialResult: { content: [{ type: "text", text: "phase one" }] },
	});
	expect(mapper.snapshot()?.items[0]).toMatchObject({
		status: "running",
		output: [{ type: "text", text: "phase one" }],
	});
	mapper.handle({
		type: "message_end",
		message: {
			role: "toolResult",
			toolCallId: "command",
			toolName: "bash",
			content: [{ type: "text", text: "confirmed final output" }],
			isError: true,
			timestamp: 20,
		},
	});
	expect(mapper.snapshot()?.items[0]).toMatchObject({
		status: "failed",
		output: [{ type: "text", text: "confirmed final output" }],
		completedAt: 20,
	});
	const confirmed = mapper.snapshot();
	const count = notes.length;
	mapper.handle({
		type: "tool_execution_update",
		toolCallId: "command",
		toolName: "bash",
		args: call.arguments,
		partialResult: { content: [{ type: "text", text: "late partial" }] },
	});
	mapper.handle({
		type: "tool_execution_end",
		toolCallId: "command",
		toolName: "bash",
		isError: false,
		result: { content: [{ type: "text", text: "late raw result" }] },
	});
	expect(mapper.snapshot()).toEqual(confirmed);
	expect(notes).toHaveLength(count);
});

test("exposes a fast parallel result before saved results arrive without finalizing its status or changes", () => {
	const { mapper, notes } = fixture();
	const fast = fauxToolCall("edit", { path: "a.ts" }, { id: "fast" });
	const slow = fauxToolCall("bash", { command: "long check" }, { id: "slow" });
	mapper.handle({ type: "message_end", message: fauxAssistantMessage([fast, slow], { stopReason: "toolUse" }) });
	for (const call of [fast, slow])
		mapper.handle({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.arguments });
	mapper.handle({
		type: "tool_execution_end",
		toolCallId: fast.id,
		toolName: fast.name,
		isError: false,
		result: {
			content: [{ type: "text", text: "provisional fast output" }],
			details: { fileChanges: [{ path: "a.ts", kind: "modify" }] },
		},
	});
	expect(notes.at(-1)).toMatchObject({
		method: "item/toolCall/outputDelta",
		params: { itemId: "fast", output: [{ type: "text", text: "provisional fast output" }] },
	});
	const item = mapper.snapshot()!.items[0];
	expect(item).toMatchObject({ status: "running", output: [{ type: "text", text: "provisional fast output" }] });
	expect(item).not.toHaveProperty("completedAt");
	expect(item).not.toHaveProperty("fileChanges");
	mapper.handle({
		type: "message_end",
		message: {
			role: "toolResult",
			toolCallId: fast.id,
			toolName: fast.name,
			content: [{ type: "text", text: "Final hook rejected this output." }],
			isError: true,
			timestamp: 30,
		},
	});
	expect(mapper.snapshot()?.items[0]).toMatchObject({
		status: "failed",
		output: [{ type: "text", text: "Final hook rejected this output." }],
		completedAt: 30,
	});
});

test("bounds command previews but keeps the full finalized command", () => {
	const { mapper, partial, update } = fixture();
	const command = "echo ".repeat(10_000);
	const call = fauxToolCall("bash", { command }, { id: "large-command" });
	partial.content.push(call);
	update({ type: "toolcall_start", contentIndex: 0, partial });
	expect(mapper.snapshot()?.items[0]).toMatchObject({ input: { command: command.slice(0, 2_000) } });
	mapper.handle({ type: "message_end", message: fauxAssistantMessage([call], { stopReason: "toolUse" }) });
	expect(mapper.snapshot()?.items[0]).toMatchObject({ input: { command } });
});
