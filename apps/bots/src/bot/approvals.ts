// Durable approvals (spec section 24): a pending approval holds an immutable SHA-256 digest of the exact action, the
// policy version and an expiry, and is consumed once, right before dispatch. A changed action, an expired approval or a
// revoked permission invalidates it. Consumption is one synchronous read-and-update in the object's SQLite, so two
// devices answering together get "ok" once.
import type { Approval } from "@knightcode/bots-protocol";
import type { ActionIntent } from "./actions.ts";

export type ConsumeResult = "ok" | "used" | "changed" | "expired" | "revoked";

/** JSON with object keys sorted, so equal actions always serialize alike. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.filter((key) => (value as Record<string, unknown>)[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

/** SHA-256 (hex) of the canonical action. */
export async function digestOf(action: ActionIntent): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(action)));
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createApprovalsTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS approvals (
		id TEXT PRIMARY KEY,
		bot_id TEXT NOT NULL,
		action_id TEXT NOT NULL,
		digest TEXT NOT NULL,
		action TEXT NOT NULL,
		policy_version INTEGER NOT NULL,
		expires_at INTEGER NOT NULL,
		state TEXT NOT NULL
	)`);
}

type Row = {
	id: string;
	bot_id: string;
	action_id: string;
	digest: string;
	action: string;
	policy_version: number;
	expires_at: number;
	state: Approval["state"];
};

const toApproval = (row: Row): Approval & { actionId: string } => {
	const action = JSON.parse(row.action) as ActionIntent;
	return {
		id: row.id,
		botId: row.bot_id,
		actionId: row.action_id,
		digest: row.digest,
		action: {
			tool: action.tool,
			title: action.title,
			...(action.target ? { target: action.target } : {}),
			...(action.spend ? { spend: action.spend } : {}),
		},
		expiresAt: row.expires_at,
		state: row.expires_at <= Date.now() && row.state === "pending" ? "expired" : row.state,
	};
};

/** Stores a pending approval for the exact `action` (recorded as `actionId`) under `policyVersion`. */
export async function createApproval(
	sql: SqlStorage,
	input: { botId: string; actionId: string; action: ActionIntent; policyVersion: number; ttlMs: number },
): Promise<Approval & { actionId: string }> {
	const id = `apr_${crypto.randomUUID()}`;
	sql.exec(
		"INSERT INTO approvals (id, bot_id, action_id, digest, action, policy_version, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
		id,
		input.botId,
		input.actionId,
		await digestOf(input.action),
		JSON.stringify(input.action),
		input.policyVersion,
		Date.now() + input.ttlMs,
	);
	return getApproval(sql, id)!;
}

export function getApproval(sql: SqlStorage, id: string): (Approval & { actionId: string }) | undefined {
	const row = sql.exec<Row>("SELECT * FROM approvals WHERE id = ?", id).toArray()[0];
	return row ? toApproval(row) : undefined;
}

/**
 * Consumes the approval for the action about to run, whose digest is `digest`. Synchronous from the read to the write:
 * no other call can consume it in between. `policyVersion` is the current one; an approval granted under another is
 * revoked, as is a denied one.
 */
export function consumeApproval(sql: SqlStorage, id: string, digest: string, policyVersion?: number): ConsumeResult {
	const row = sql.exec<Row>("SELECT * FROM approvals WHERE id = ?", id).toArray()[0];
	if (!row || row.state === "denied") return "revoked";
	if (row.state === "allowed") return "used";
	if (row.state === "expired" || row.expires_at <= Date.now()) {
		sql.exec("UPDATE approvals SET state = 'expired' WHERE id = ?", id);
		return "expired";
	}
	if (policyVersion !== undefined && policyVersion !== row.policy_version) return "revoked";
	if (digest !== row.digest) return "changed";
	sql.exec("UPDATE approvals SET state = 'allowed' WHERE id = ? AND state = 'pending'", id);
	return "ok";
}

/** Denies a pending approval; consuming it afterwards answers "revoked". */
export function denyApproval(sql: SqlStorage, id: string): void {
	sql.exec("UPDATE approvals SET state = 'denied' WHERE id = ? AND state = 'pending'", id);
}
