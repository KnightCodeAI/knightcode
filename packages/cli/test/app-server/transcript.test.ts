import { expect, test } from "vitest";
import { DECLINED_REASON, entryForItem, readTurns } from "../../src/app-server/transcript.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { TURN_END_TYPE, TURN_MARKER_TYPE } from "../../src/extensions/turn-marker.ts";

let n = 0;
const base = () => ({ id: `e${n++}`, parentId: null, timestamp: "2026-10-11T00:00:00.000Z" });
const marker = (): SessionEntry => ({ ...base(), type: "custom", customType: TURN_MARKER_TYPE }) as SessionEntry;
const end = (status: string, error?: string): SessionEntry =>
	({
		...base(),
		type: "custom",
		customType: TURN_END_TYPE,
		data: error ? { status, error } : { status },
	}) as SessionEntry;
const user = (text: string): SessionEntry =>
	({
		...base(),
		type: "message",
		message: { role: "user", content: [{ type: "text", text }], timestamp: 0 },
	}) as SessionEntry;
const assistant = (content: unknown[], stopReason = "stop"): SessionEntry =>
	({ ...base(), type: "message", message: { role: "assistant", content, stopReason, timestamp: 0 } }) as SessionEntry;
const toolResult = (toolCallId: string, toolName: string, text: string, isError = false): SessionEntry =>
	({
		...base(),
		type: "message",
		message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 0 },
	}) as SessionEntry;
const compaction = (summary: string): SessionEntry =>
	({ ...base(), type: "compaction", summary, firstKeptEntryId: "e0", tokensBefore: 0 }) as SessionEntry;

test("a marked turn keeps its steers, numbers items by ordinal and takes its status from the end entry", () => {
	const m = marker();
	const entries = [
		m,
		user("do it"),
		assistant(
			[
				{ type: "thinking", thinking: "hmm" },
				{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts" } },
			],
			"toolUse",
		),
		toolResult("c1", "edit", "ok"),
		user("also this"),
		assistant([{ type: "text", text: "done" }]),
		end("completed"),
	];
	const [turn] = readTurns("t", entries);
	expect(turn.id).toBe(m.id);
	expect(turn.status).toBe("completed");
	expect(turn.items.map((i) => i.id)).toEqual([`${m.id}:user:0`, `${m.id}:0:0`, "c1", `${m.id}:user:1`, `${m.id}:1:0`]);
	expect(turn.items[2]).toMatchObject({
		type: "toolCall",
		status: "completed",
		output: [{ type: "text", text: "ok" }],
		fileChanges: [{ path: "a.ts", kind: "modify" }],
	});
});

test("tool calls sit at their blocks in block order; results never reorder them; a call with no result failed", () => {
	const m = marker();
	const entries = [
		m,
		user("go"),
		assistant(
			[
				{ type: "toolCall", id: "w", name: "write", arguments: { path: "a.ts" } },
				{ type: "toolCall", id: "r", name: "read", arguments: { path: "b.ts" } },
			],
			"toolUse",
		),
		// Results in completion order, the reverse of block order.
		toolResult("r", "read", "b"),
		toolResult("w", "write", "ok"),
		assistant([{ type: "toolCall", id: "x", name: "bash", arguments: {} }], "aborted"),
		end("interrupted"),
	];
	const [turn] = readTurns("t", entries);
	expect(turn.items.map((i) => i.id)).toEqual([`${m.id}:user:0`, "w", "r", "x"]);
	expect(turn.items.find((i) => i.id === "x")).toMatchObject({ status: "failed", output: [] });
});

test("a retried failure counts as an assistant message, and the end entry wins over it", () => {
	const m = marker();
	const turns = readTurns("t", [
		m,
		user("go"),
		assistant([], "error"),
		assistant([{ type: "text", text: "ok" }]),
		end("completed"),
	]);
	expect(turns[0].status).toBe("completed");
	expect(turns[0].items.map((i) => i.id)).toEqual([`${m.id}:user:0`, `${m.id}:1:0`]);
});

test("a marker without an end entry is interrupted unless the thread is running it", () => {
	const entries = [marker(), user("go"), assistant([{ type: "text", text: "partial" }], "toolUse")];
	expect(readTurns("t", entries)[0].status).toBe("interrupted");
	expect(readTurns("t", entries, entries[0].id)[0].status).toBe("inProgress");
});

test("an idle compaction after the end entry stays in that turn", () => {
	const m = marker();
	const turns = readTurns("t", [
		m,
		user("go"),
		assistant([{ type: "text", text: "a" }]),
		end("completed"),
		compaction("sum"),
	]);
	expect(turns).toHaveLength(1);
	expect(turns[0].items.at(-1)).toMatchObject({ type: "compaction", id: `${m.id}:compaction:0`, summary: "sum" });
});

test("an unmarked user message after a turn's end opens a new turn", () => {
	const m = marker();
	const later = user("from a run without markers");
	const turns = readTurns("t", [m, user("go"), assistant([{ type: "text", text: "a" }]), end("completed"), later]);
	expect(turns.map((t) => t.id)).toEqual([m.id, later.id]);
});

test("a session without markers reads back one turn per user message", () => {
	const first = user("one");
	const second = user("two");
	const turns = readTurns("t", [
		first,
		assistant([{ type: "text", text: "a" }]),
		second,
		assistant([{ type: "text", text: "b" }], "aborted"),
	]);
	expect(turns.map((t) => t.id)).toEqual([first.id, second.id]);
	expect(turns[1].status).toBe("interrupted");
});

test("a declined call reads back declined, a failed end reads back failed, an empty marked turn is dropped", () => {
	const entries = [
		marker(),
		user("x"),
		assistant([{ type: "toolCall", id: "c2", name: "bash", arguments: {} }], "toolUse"),
		toolResult("c2", "bash", DECLINED_REASON, true),
		assistant([], "error"),
		end("failed", "boom"),
		marker(),
	];
	const turns = readTurns("t", entries);
	expect(turns).toHaveLength(1);
	expect(turns[0].items.find((i) => i.id === "c2")).toMatchObject({ status: "declined" });
	expect(turns[0]).toMatchObject({ status: "failed", error: { message: "boom", kind: "other" } });
});

test("entryForItem finds the entry holding an item", () => {
	const m = marker();
	const u = user("hi");
	const a = assistant([{ type: "text", text: "yo" }]);
	expect(entryForItem([m, u, a], `${m.id}:user:0`)).toBe(u.id);
	expect(entryForItem([m, u, a], `${m.id}:0:0`)).toBe(a.id);
	expect(entryForItem([m, u, a], "nope")).toBeUndefined();
});

test("turn and item times use the durable marker, messages and end", () => {
	const m = marker();
	const u = user("hi");
	const a = assistant([
		{ type: "text", text: "read" },
		{ type: "toolCall", id: "c", name: "read", arguments: {} },
	]);
	const r = toolResult("c", "read", "ok");
	const e = end("completed");
	if (u.type !== "message" || a.type !== "message" || r.type !== "message" || a.message.role !== "assistant")
		throw new Error("fixtures");
	u.message.timestamp = 1000;
	a.message.timestamp = 2000;
	a.message.durationMs = 500;
	r.message.timestamp = 3000;
	e.timestamp = new Date(4000).toISOString();
	const [turn] = readTurns("t", [m, u, a, r, e]);
	expect(turn.startedAt).toBe(Date.parse(m.timestamp));
	expect(turn.completedAt).toBe(4000);
	expect(turn.items[0]).toMatchObject({ completedAt: 1000 });
	expect(turn.items[0]).not.toHaveProperty("startedAt");
	expect(turn.items[1]).toMatchObject({ startedAt: 2000, completedAt: 2500 });
	expect(turn.items[2]).toMatchObject({ startedAt: 2500, completedAt: 3000 });
});
