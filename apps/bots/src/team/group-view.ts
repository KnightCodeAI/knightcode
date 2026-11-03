// A group chat's thread as the client sees it: its messages (the user's, and each bot's under its own name) and the
// turns a bot passed on or let time out, in time order.
import type { ConversationView, Entry } from "@knightcode/bots-protocol";

export async function groupEntries(db: D1Database, groupId: string, reactions: Record<string, { emoji: string; count: number; mine: boolean }[]> = {}): Promise<Entry[]> {
	const messages = await db
		.prepare("SELECT seq, author, text, at FROM group_messages WHERE group_id = ? ORDER BY seq")
		.bind(groupId)
		.all<{ seq: number; author: string; text: string; at: number }>();
	const turns = await db
		.prepare("SELECT turn_id, member, state, issued_at FROM group_turns WHERE group_id = ? AND state IN ('passed', 'timed_out') ORDER BY issued_at")
		.bind(groupId)
		.all<{ turn_id: string; member: string; state: string; issued_at: number }>();
	const entries: Entry[] = [
		...messages.results.map((row): Entry => {
			const id = `${groupId}-${row.seq}`;
			return {
				kind: "message",
				id,
				role: row.author === "user" ? "user" : "assistant",
				...(row.author === "user" ? {} : { botId: row.author }),
				text: row.text,
				createdAt: row.at,
				...(reactions[id]?.length ? { reactions: reactions[id] } : {}),
			};
		}),
		...turns.results.map((row): Entry => ({ kind: "turn", id: row.turn_id, botId: row.member, outcome: row.state === "passed" ? "pass" : "timeout", createdAt: row.issued_at })),
	];
	return entries.sort((a, b) => a.createdAt - b.createdAt);
}

/** A page of the thread: at most `limit` entries before `before`. */
export function pageOf(entries: Entry[], running: boolean, before?: string, limit = 50): ConversationView {
	const end = before ? entries.findIndex((entry) => entry.id === before) : entries.length;
	const stop = end < 0 ? entries.length : end;
	const start = Math.max(0, stop - limit);
	return { entries: entries.slice(start, stop), running, hasEarlier: start > 0 };
}
