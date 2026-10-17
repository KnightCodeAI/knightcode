/** Anchored history pages: appends do not shift continuations, and active snapshots are separate. */
import type { ResultOf, Thread, ThreadSummary, WireTurn } from "@knightcode/app-server-protocol";
import type { SessionEntry } from "../core/session-manager.ts";
import { AppServerError } from "./errors.ts";
import type { PayloadStore } from "./payloads.ts";
import { readTurns } from "./transcript.ts";

export const MAX_HISTORY_TURNS = 50;
export const MAX_HISTORY_RESPONSE_BYTES = 1_048_576;
export const HISTORY_ENVELOPE_RESERVE_BYTES = 1024;
export type HistoryPage = Pick<ResultOf<"thread/read">, "turns" | "runningTurn" | "nextCursor">;
interface Cursor {
	version: 1;
	threadId: string;
	branchTipId: string;
	beforeTurnId: string;
	excludedActiveTurnId?: string;
}
function invalid(): never {
	throw new AppServerError(
		"invalidCursor",
		"History cursor is malformed, belongs to another thread, or its branch changed; read the thread again",
	);
}
function decode(value: string): Cursor {
	if (Buffer.byteLength(value) > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		invalid();
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) invalid();
	const cursor = parsed as Partial<Cursor>;
	if (
		cursor.version !== 1 ||
		typeof cursor.threadId !== "string" ||
		typeof cursor.branchTipId !== "string" ||
		typeof cursor.beforeTurnId !== "string" ||
		(cursor.excludedActiveTurnId !== undefined && typeof cursor.excludedActiveTurnId !== "string")
	)
		invalid();
	return cursor as Cursor;
}
function encode(value: Cursor): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function pageHistory(
	input: { thread: Thread | ThreadSummary; entries: readonly SessionEntry[]; cursor?: string; runningTurn?: WireTurn },
	payloads: PayloadStore,
): HistoryPage {
	const { thread, entries, runningTurn } = input;
	const cursor = input.cursor === undefined ? undefined : decode(input.cursor);
	if (cursor && cursor.threadId !== thread.id) invalid();
	const tip = cursor ? entries.findIndex((entry) => entry.id === cursor.branchTipId) : entries.length - 1;
	if (cursor && tip < 0) invalid();
	const excludedActiveTurnId = cursor?.excludedActiveTurnId ?? runningTurn?.id;
	const turns = readTurns(thread.id, entries.slice(0, tip + 1)).filter((turn) => turn.id !== excludedActiveTurnId);
	const before = cursor ? turns.findIndex((turn) => turn.id === cursor.beforeTurnId) : turns.length;
	if (before < 0) invalid();
	const page: HistoryPage = { turns: [], ...(runningTurn === undefined ? {} : { runningTurn }) };
	// Sized incrementally: each turn adds its JSON and a separating comma, a cursor adds its member.
	let bytes = Buffer.byteLength(JSON.stringify({ thread, ...page })) + HISTORY_ENVELOPE_RESERVE_BYTES;
	if (bytes > MAX_HISTORY_RESPONSE_BYTES)
		throw new AppServerError("internal", "Thread metadata or active snapshot exceeds the history response limit");
	for (let i = before - 1; i >= 0 && page.turns.length < MAX_HISTORY_TURNS; i--) {
		const turn = payloads.turn(turns[i]);
		const turnBytes = Buffer.byteLength(JSON.stringify(turn)) + (page.turns.length > 0 ? 1 : 0);
		const nextCursor =
			i > 0
				? encode({
						version: 1,
						threadId: thread.id,
						branchTipId: entries[tip].id,
						beforeTurnId: turn.id,
						...(excludedActiveTurnId === undefined ? {} : { excludedActiveTurnId }),
					})
				: undefined;
		const cursorBytes = nextCursor === undefined ? 0 : Buffer.byteLength(`,"nextCursor":"${nextCursor}"`);
		if (bytes + turnBytes + cursorBytes > MAX_HISTORY_RESPONSE_BYTES) {
			if ("payload" in turn) payloads.release(turn.payload);
			if (page.turns.length === 0)
				throw new AppServerError("internal", "Thread metadata or active snapshot exceeds the history response limit");
			break;
		}
		bytes += turnBytes;
		page.turns.unshift(turn);
		page.nextCursor = nextCursor;
	}
	return page;
}
