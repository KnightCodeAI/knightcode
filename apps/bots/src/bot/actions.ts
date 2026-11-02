// Action records (spec section 24): every outward write is committed as a record before it is sent, with a stable id,
// the intent, the approval that covers it and its delivery state. The state is set to `unknown` before each send, so a
// crash or an error mid-send leaves the outcome unknown, and an action whose adapter can neither dedupe nor check is
// never sent twice. Callers serialize deliveries of one action (the bot object does), so a check and a send never
// overlap another delivery of the same action.
import { type HostWrite, immediateWrite } from "./host-sql.ts";

/** One outward write a bot wants to make. */
export interface ActionIntent {
	/** The tool or adapter action, such as "email.send" or "github.comment". */
	tool: string;
	/** One line for the approval card. */
	title: string;
	/** What it acts on: a recipient, a repository, a site. */
	target?: string;
	/** The exact payload, part of the approval digest. */
	args: unknown;
	spend?: { merchant: string; amount: number; currency: string; item: string };
}

export type ActionState = "pending" | "sent" | "confirmed" | "unknown" | "failed";

export interface ActionRecord {
	id: string;
	botId: string;
	intent: ActionIntent;
	approvalId?: string;
	state: ActionState;
	attempts: number;
	error?: string;
}

/** What one send reports: sent (confirmed when the destination acknowledged it), or not sent at all. */
export type DeliveryResult = { ok: true; confirmed?: boolean } | { ok: false; error: string };

export type WriteAdapter = {
	id: string;
	/** idempotent: the destination honours the action id; reconcilable: `check` says whether it happened; neither. */
	kind: "idempotent" | "reconcilable" | "neither";
	send(action: ActionRecord): Promise<DeliveryResult>;
	check?(action: ActionRecord): Promise<"done" | "not_done" | "unknown">;
};

export function createActionsTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS actions (
		id TEXT PRIMARY KEY,
		bot_id TEXT NOT NULL,
		intent TEXT NOT NULL,
		approval_id TEXT,
		state TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		error TEXT,
		approved_at INTEGER,
		created_at INTEGER NOT NULL
	)`);
}

type Row = { id: string; bot_id: string; intent: string; approval_id: string | null; state: ActionState; attempts: number; error: string | null };

const toRecord = (row: Row): ActionRecord => ({
	id: row.id,
	botId: row.bot_id,
	intent: JSON.parse(row.intent) as ActionIntent,
	...(row.approval_id ? { approvalId: row.approval_id } : {}),
	state: row.state,
	attempts: row.attempts,
	...(row.error ? { error: row.error } : {}),
});

/** Commits a pending record for `intent`; `id` makes a retried call find the same record. */
export function recordAction(
	sql: SqlStorage,
	botId: string,
	intent: ActionIntent,
	options: { id?: string; approvalId?: string } = {},
): ActionRecord {
	const id = options.id ?? `act_${crypto.randomUUID()}`;
	sql.exec(
		"INSERT OR IGNORE INTO actions (id, bot_id, intent, approval_id, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
		id,
		botId,
		JSON.stringify(intent),
		options.approvalId ?? null,
		Date.now(),
	);
	return getAction(sql, id)!;
}

export function getAction(sql: SqlStorage, id: string): ActionRecord | undefined {
	const row = sql.exec<Row>("SELECT * FROM actions WHERE id = ?", id).toArray()[0];
	return row ? toRecord(row) : undefined;
}

const setState = (write: HostWrite, id: string, state: ActionState, error?: string) =>
	write((sql) => void sql.exec("UPDATE actions SET state = ?, error = ? WHERE id = ?", state, error ?? null, id));

/** Marks an action as approved for delivery, so delivery resumes after a failure or an eviction until it settles. */
export function markApproved(sql: SqlStorage, id: string): void {
	sql.exec("UPDATE actions SET approved_at = ? WHERE id = ? AND approved_at IS NULL", Date.now(), id);
}

/** Approved actions not yet settled: pending (not sent yet, or a definite failure), or unknown and safe to resolve. */
export function deliveriesToResume(sql: SqlStorage): string[] {
	return sql
		.exec<{ id: string }>("SELECT id FROM actions WHERE approved_at IS NOT NULL AND state IN ('pending', 'unknown') ORDER BY created_at")
		.toArray()
		.map((row) => row.id);
}

/**
 * Sends the action once if that is safe, and returns its state. Sent and confirmed actions are left alone. An unknown
 * outcome is resolved by the adapter's kind: a reconcilable adapter checks first, an idempotent one sends again, and
 * `neither` never sends again (the bot reports it and asks).
 */
export async function dispatch(
	sql: SqlStorage,
	record: ActionRecord,
	adapter: WriteAdapter,
	write: HostWrite = immediateWrite(sql),
): Promise<ActionState> {
	const current = getAction(sql, record.id) ?? record;
	if (current.state === "sent" || current.state === "confirmed" || current.state === "failed") return current.state;
	if (current.state === "unknown") {
		if (adapter.kind === "neither") return "unknown";
		if (adapter.kind === "reconcilable") {
			const found = adapter.check ? await adapter.check(current).catch(() => "unknown" as const) : "unknown";
			if (found === "done") {
				await setState(write, current.id, "confirmed");
				return "confirmed";
			}
			if (found === "unknown") return "unknown";
		}
	}
	// In flight the outcome is unknown: a crash from here on leaves it so.
	await write((db) => void db.exec("UPDATE actions SET state = 'unknown', attempts = attempts + 1 WHERE id = ?", current.id));
	let result: DeliveryResult;
	try {
		result = await adapter.send({ ...current, state: "unknown", attempts: current.attempts + 1 });
	} catch (error) {
		await setState(write, current.id, "unknown", error instanceof Error ? error.message : String(error));
		return "unknown";
	}
	if (result.ok) {
		const state = result.confirmed ? "confirmed" : "sent";
		await setState(write, current.id, state);
		return state;
	}
	// Definitely not sent: safe to try again.
	await setState(write, current.id, "pending", result.error);
	return "pending";
}
