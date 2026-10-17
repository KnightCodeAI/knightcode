import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadSummary, WireTurn } from "@knightcode/app-server-protocol";
import { afterAll, expect, test } from "vitest";
import {
	pageHistory,
	MAX_HISTORY_RESPONSE_BYTES,
	HISTORY_ENVELOPE_RESERVE_BYTES,
} from "../../src/app-server/history-pages.ts";
import { PayloadStore } from "../../src/app-server/payloads.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { TURN_END_TYPE, TURN_MARKER_TYPE } from "../../src/extensions/turn-marker.ts";

const dir = mkdtempSync(join(tmpdir(), "kc-history-pages-"));
const store = new PayloadStore(dir);
afterAll(async () => {
	await store.close();
	rmSync(dir, { recursive: true, force: true });
});
const thread: ThreadSummary = {
	id: "thread",
	cwd: "cwd",
	projectCwd: "cwd",
	name: "n",
	status: { type: "idle" },
	createdAt: "2026-10-11T00:00:00.000Z",
	archived: false,
	updatedAt: "2026-10-11",
};
const entries: SessionEntry[] = [];
function add(index: number, text = "hello") {
	const base = { parentId: entries.at(-1)?.id ?? null, timestamp: "2026-10-11T00:00:00.000Z" };
	entries.push({ ...base, id: `m${index}`, type: "custom", customType: TURN_MARKER_TYPE });
	entries.push({
		...base,
		id: `u${index}`,
		type: "message",
		message: { role: "user", content: [{ type: "text", text }], timestamp: index },
	});
	entries.push({ ...base, id: `e${index}`, type: "custom", customType: TURN_END_TYPE, data: { status: "completed" } });
}

test("history continuations anchor to the original branch and exclude subsequent appends", () => {
	entries.length = 0;
	for (let i = 0; i < 121; i++) add(i);
	const first = pageHistory({ thread, entries }, store);
	add(121);
	const second = pageHistory({ thread, entries, cursor: first.nextCursor }, store);
	const third = pageHistory({ thread, entries, cursor: second.nextCursor }, store);
	expect([...third.turns, ...second.turns, ...first.turns].map((t) => t.id)).toEqual(
		Array.from({ length: 121 }, (_, i) => `m${i}`),
	);
	expect(third.nextCursor).toBeUndefined();
	expect(() => pageHistory({ thread, entries, cursor: "invalid" }, store)).toThrow(
		expect.objectContaining({ code: "invalidCursor" }),
	);
	expect(() => pageHistory({ thread: { ...thread, id: "other" }, entries, cursor: first.nextCursor }, store)).toThrow(
		expect.objectContaining({ code: "invalidCursor" }),
	);
	expect(() => pageHistory({ thread, entries: entries.slice(0, 100), cursor: first.nextCursor }, store)).toThrow(
		expect.objectContaining({ code: "invalidCursor" }),
	);
});

test("old-page history keeps a separate current running snapshot and respects the byte budget", async () => {
	entries.length = 0;
	for (let i = 0; i < 51; i++) add(i, "😀".repeat(20_000));
	const runningTurn: WireTurn = {
		startedAt: 1,
		id: "active",
		threadId: thread.id,
		status: "inProgress",
		items: [{ type: "agentMessage", id: "i", text: "partial" }],
	};
	const first = pageHistory({ thread, entries, runningTurn }, store);
	const next = pageHistory({ thread, entries, cursor: first.nextCursor, runningTurn }, store);
	expect(next.runningTurn).toEqual(runningTurn);
	expect(first.turns).toHaveLength(50);
	expect(first.turns.every((t) => "payload" in t)).toBe(true);
	for (const page of [first, next])
		expect(Buffer.byteLength(JSON.stringify({ thread, ...page })) + HISTORY_ENVELOPE_RESERVE_BYTES).toBeLessThanOrEqual(
			MAX_HISTORY_RESPONSE_BYTES,
		);
});

test("a byte-limited page takes as many inline turns as fit, and no more", () => {
	entries.length = 0;
	for (let i = 0; i < 30; i++) add(i, "x".repeat(60_000));
	const page = pageHistory({ thread, entries }, store);
	const bytes = Buffer.byteLength(JSON.stringify({ thread, ...page })) + HISTORY_ENVELOPE_RESERVE_BYTES;
	expect(page.turns.every((t) => !("payload" in t))).toBe(true);
	expect(bytes).toBeLessThanOrEqual(MAX_HISTORY_RESPONSE_BYTES);
	// The next older turn would not have fit.
	expect(bytes + 60_000).toBeGreaterThan(MAX_HISTORY_RESPONSE_BYTES);
	expect(page.turns.at(-1)?.id).toBe("m29");
});

test("a rejected turn's payload reference is released", () => {
	entries.length = 0;
	add(0, "😀".repeat(20_000));
	const runningTurn = (text: string): WireTurn => ({
		startedAt: 1,
		id: "active",
		threadId: thread.id,
		status: "inProgress",
		items: [{ type: "agentMessage", id: "i", text }],
	});
	// Leave less room than a turn reference needs.
	const empty = Buffer.byteLength(JSON.stringify({ thread, turns: [], runningTurn: runningTurn("") }));
	const filler = "y".repeat(MAX_HISTORY_RESPONSE_BYTES - HISTORY_ENVELOPE_RESERVE_BYTES - empty - 10);
	const before = store.getStats().payloads;
	expect(() => pageHistory({ thread, entries, runningTurn: runningTurn(filler) }, store)).toThrow(
		expect.objectContaining({ code: "internal" }),
	);
	expect(store.getStats().payloads).toBe(before);
});
