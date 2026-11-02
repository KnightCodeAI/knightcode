// Group chats (spec section 11): 2 to 10 bots and the user share one conversation; each bot keeps its own memory and
// computer. The group asks each relevant bot for a turn, giving it only the messages since its last turn, the other
// members and a deadline; a bot replies or passes. When the turn budget is spent, bots are told to wrap up. A result for
// a cancelled or superseded turn is rejected by its turn id, so a late answer never lands out of place.

export type TurnOutcome = "sent" | "pass" | "skipped" | "timeout" | "cancelled" | "error";

export interface GroupMessage {
	seq: number;
	author: string;
	text: string;
	at: number;
}

export interface TurnRequest {
	since: GroupMessage[];
	peers: string[];
	deadline: number;
	windingDown: boolean;
}

/** What a member answers to its turn. */
export type TurnAnswer = { reply: string } | { pass: true };

export type Asker = (member: string, request: TurnRequest, turnId: string) => Promise<TurnAnswer>;

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 10;

/** Who answers a message: those @mentioned, everyone for @everyone, else the lead. */
export function addressees(text: string, members: { id: string; name: string }[], lead: string): string[] {
	if (/@everyone\b/i.test(text)) return members.map((member) => member.id);
	const named = members.filter((member) => new RegExp(`@${member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
	return named.length > 0 ? named.map((member) => member.id) : [lead];
}

export class GroupTurns {
	readonly #db: D1Database;
	readonly #now: () => number;

	constructor(db: D1Database, now: () => number = Date.now) {
		this.#db = db;
		this.#now = now;
	}

	async post(groupId: string, author: string, text: string): Promise<GroupMessage> {
		const at = this.#now();
		const row = await this.#db
			.prepare(
				"INSERT INTO group_messages (group_id, seq, author, text, at) VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM group_messages WHERE group_id = ?1), ?2, ?3, ?4) RETURNING seq",
			)
			.bind(groupId, author, text, at)
			.first<{ seq: number }>();
		return { seq: row!.seq, author, text, at };
	}

	async messages(groupId: string, afterSeq = 0): Promise<GroupMessage[]> {
		const rows = await this.#db
			.prepare("SELECT seq, author, text, at FROM group_messages WHERE group_id = ? AND seq > ? ORDER BY seq")
			.bind(groupId, afterSeq)
			.all<GroupMessage>();
		return rows.results;
	}

	/** Issues a turn for `member`, superseding any turn it still holds in this group. */
	async issue(groupId: string, member: string): Promise<string> {
		const turnId = `turn_${crypto.randomUUID()}`;
		await this.#db.batch([
			this.#db.prepare("UPDATE group_turns SET state = 'superseded' WHERE group_id = ? AND member = ? AND state = 'open'").bind(groupId, member),
			this.#db.prepare("INSERT INTO group_turns (turn_id, group_id, member, state, issued_at) VALUES (?, ?, ?, 'open', ?)").bind(turnId, groupId, member, this.#now()),
		]);
		return turnId;
	}

	async cancel(turnId: string): Promise<void> {
		await this.#db.prepare("UPDATE group_turns SET state = 'cancelled' WHERE turn_id = ? AND state = 'open'").bind(turnId).run();
	}

	/** Closes an open turn; false when it was cancelled or superseded meanwhile (its result is then rejected). */
	async close(turnId: string, state: "answered" | "passed" | "timed_out" | "failed"): Promise<boolean> {
		const closed = await this.#db.prepare("UPDATE group_turns SET state = ? WHERE turn_id = ? AND state = 'open'").bind(state, turnId).run();
		return closed.meta.changes === 1;
	}

	/**
	 * Asks `member` for a turn and posts its reply, unless it passes. A member with nothing new since its last turn is
	 * skipped; a reply after the deadline, or for a turn cancelled or superseded meanwhile, is not posted.
	 */
	async requestTurn(
		groupId: string,
		member: string,
		options: { since: number; peers: string[]; deadline: number; windingDown: boolean },
		ask: Asker,
	): Promise<{ outcome: TurnOutcome; turnId?: string }> {
		const since = (await this.messages(groupId, options.since)).filter((message) => message.author !== member);
		if (since.length === 0) return { outcome: "skipped" };
		const turnId = await this.issue(groupId, member);
		const timeout = Math.max(0, options.deadline - this.#now());
		let answer: TurnAnswer | "timeout";
		try {
			answer = await Promise.race([
				ask(member, { since, peers: options.peers, deadline: options.deadline, windingDown: options.windingDown }, turnId),
				new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeout)),
			]);
		} catch {
			return { outcome: (await this.close(turnId, "failed")) ? "error" : "cancelled", turnId };
		}
		if (answer === "timeout") return { outcome: (await this.close(turnId, "timed_out")) ? "timeout" : "cancelled", turnId };
		if ("pass" in answer) return { outcome: (await this.close(turnId, "passed")) ? "pass" : "cancelled", turnId };
		// The turn must still be ours when the answer lands.
		if (!(await this.close(turnId, "answered"))) return { outcome: "cancelled", turnId };
		await this.post(groupId, member, answer.reply);
		return { outcome: "sent", turnId };
	}
}
