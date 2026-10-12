/**
 * Turn boundaries in the session file (app server §4.2).
 *
 * The file has no notion of a turn, and agent_start is not one: a retry, a follow-up or overflow
 * recovery starts the agent again inside one run, which settles once. This built-in writes
 * `knightcode.turn` at the first agent_start of a run and `knightcode.turnEnd` with the outcome at
 * agent_settled. The marker's entry id is the turn id. The app server's live mapper and its reader
 * both use these helpers, so a live turn and the same turn read back carry the same ids and status.
 */

import type { InlineExtension } from "../core/extensions/types.ts";
import type { SessionEntry } from "../core/session-manager.ts";

export const TURN_MARKER_TYPE = "knightcode.turn";
export const TURN_END_TYPE = "knightcode.turnEnd";

export interface TurnEnd {
	status: "completed" | "interrupted" | "failed";
	error?: string;
}

export const isTurnMarker = (entry: SessionEntry): boolean =>
	entry.type === "custom" && entry.customType === TURN_MARKER_TYPE;
export const isTurnEnd = (entry: SessionEntry): boolean =>
	entry.type === "custom" && entry.customType === TURN_END_TYPE;

/** The outcome of a settled run: an abort wins; otherwise the run's last assistant message decides. */
export function turnEndOf(aborted: boolean, branch: readonly SessionEntry[]): TurnEnd {
	if (aborted) return { status: "interrupted" };
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) break;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message.stopReason === "aborted") return { status: "interrupted" };
		if (entry.message.stopReason === "error") {
			return { status: "failed", error: entry.message.errorMessage ?? "the turn failed" };
		}
		return { status: "completed" };
	}
	return { status: "completed" };
}

/**
 * The marker the current run wrote, if any. Walks back from the leaf: the run's marker comes before
 * any of its messages, so reaching a message or a previous turn's end first means there is none.
 * Another extension may append after the marker, so it is not necessarily the leaf.
 */
export function openMarkerOf(branch: readonly SessionEntry[]): SessionEntry | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) return entry;
		if (isTurnEnd(entry) || entry.type === "message") return undefined;
	}
	return undefined;
}

/** The end entry of the latest turn, if it has one. Malformed data reads as undefined. */
export function turnEndAt(branch: readonly SessionEntry[]): TurnEnd | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) return undefined;
		if (entry.type === "custom" && entry.customType === TURN_END_TYPE) return parseTurnEnd(entry.data);
	}
	return undefined;
}

export function parseTurnEnd(data: unknown): TurnEnd | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { status, error } = data as { status?: unknown; error?: unknown };
	if (status !== "completed" && status !== "interrupted" && status !== "failed") return undefined;
	return typeof error === "string" ? { status, error } : { status };
}

export const turnMarkerExtension: InlineExtension = {
	name: "turn-marker",
	hidden: true,
	builtin: true,
	factory: (knightcode) => {
		// Per session: the factory runs once per session. agent_settled fires once per run, including a
		// failed one, so the flag cannot stay set across runs.
		let open = false;
		knightcode.on("agent_start", () => {
			if (open) return;
			open = true;
			knightcode.appendEntry(TURN_MARKER_TYPE);
		});
		knightcode.on("agent_settled", (event, ctx) => {
			if (!open) return;
			open = false;
			knightcode.appendEntry(TURN_END_TYPE, turnEndOf(event.aborted, ctx.sessionManager.getBranch()));
		});
	},
};
