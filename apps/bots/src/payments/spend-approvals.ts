// Spending approvals (spec section 22): every purchase needs a card showing merchant, amount and item, confirmed with
// the user's passkey. The passkey's challenge is the approval's digest (UTF-8 bytes), so an assertion made for any
// other action is refused. Per-bot limits (per purchase and per month) refuse anything above them without a card.
// Completed purchases are recorded.
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { base64url, fromBase64url } from "../auth/util.ts";
import type { Env } from "../env.ts";
import type { Purchase } from "./link.ts";

export function createSpendTables(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS spend_limits (bot_id TEXT PRIMARY KEY, per_purchase INTEGER NOT NULL, per_month INTEGER NOT NULL)");
	sql.exec(
		"CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, merchant TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, item TEXT NOT NULL, approval_id TEXT, at INTEGER NOT NULL)",
	);
}

export function setLimit(sql: SqlStorage, botId: string, limit: { perPurchase: number; perMonth: number }): void {
	sql.exec(
		"INSERT INTO spend_limits (bot_id, per_purchase, per_month) VALUES (?, ?, ?) ON CONFLICT (bot_id) DO UPDATE SET per_purchase = excluded.per_purchase, per_month = excluded.per_month",
		botId,
		Math.max(0, Math.round(limit.perPurchase)),
		Math.max(0, Math.round(limit.perMonth)),
	);
}

const monthStart = (now: number) => {
	const date = new Date(now);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};

/** Refused above the bot's limits, before any card or approval exists. A bot with no limits set may not buy. */
export function checkLimits(sql: SqlStorage, botId: string, amount: number, now = Date.now()): { ok: true } | { ok: false; reason: string } {
	const limit = sql.exec<{ per_purchase: number; per_month: number }>("SELECT * FROM spend_limits WHERE bot_id = ?", botId).toArray()[0];
	if (!limit) return { ok: false, reason: "This bot has no spending limits yet; the owner sets them in Settings, Payments." };
	if (amount > limit.per_purchase) return { ok: false, reason: `Above this bot's limit of ${limit.per_purchase / 100} per purchase.` };
	const spent = sql.exec<{ total: number | null }>("SELECT SUM(amount) AS total FROM purchases WHERE bot_id = ? AND at >= ?", botId, monthStart(now)).one().total ?? 0;
	if (spent + amount > limit.per_month) return { ok: false, reason: `Above this bot's monthly limit of ${limit.per_month / 100}.` };
	return { ok: true };
}

export function recordPurchase(sql: SqlStorage, botId: string, purchase: Purchase, approvalId: string, now = Date.now()): string {
	const id = `buy_${crypto.randomUUID()}`;
	sql.exec(
		"INSERT INTO purchases (id, bot_id, merchant, amount, currency, item, approval_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		id,
		botId,
		purchase.merchant,
		purchase.amount,
		purchase.currency,
		purchase.item,
		approvalId,
		now,
	);
	return id;
}

/** The WebAuthn challenge for a spending approval: the approval's digest as UTF-8 bytes, base64url. */
export const spendChallenge = (digest: string) => base64url(new TextEncoder().encode(digest));

type Assertion = { id?: string; response?: { clientDataJSON?: string } };

/**
 * Whether `assertion` is the account's passkey confirming exactly this approval: its challenge must be this approval's
 * digest (an assertion for another action is refused before any key is looked up), then the signature must verify
 * against the account's stored passkey.
 */
export async function verifySpendAssertion(env: Env, input: { accountId: string; digest: string; assertion: unknown }): Promise<boolean> {
	const assertion = input.assertion as Assertion;
	let challenge: string | undefined;
	try {
		challenge = (JSON.parse(new TextDecoder().decode(fromBase64url(assertion.response?.clientDataJSON ?? ""))) as { challenge?: string }).challenge;
	} catch {
		return false;
	}
	if (challenge !== spendChallenge(input.digest) || !assertion.id) return false;
	const stored = await env.DB.prepare("SELECT id, public_key, counter, transports FROM passkeys WHERE id = ? AND account_id = ?")
		.bind(assertion.id, input.accountId)
		.first<{ id: string; public_key: ArrayBuffer; counter: number; transports: string | null }>();
	if (!stored) return false;
	const origin = env.APP_ORIGIN ?? "https://bots.knightcode.dev";
	try {
		const result = await verifyAuthenticationResponse({
			response: input.assertion as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
			expectedChallenge: spendChallenge(input.digest),
			expectedOrigin: origin,
			expectedRPID: new URL(origin).hostname,
			credential: { id: stored.id, publicKey: new Uint8Array(stored.public_key), counter: stored.counter },
			requireUserVerification: true,
		});
		if (!result.verified) return false;
		await env.DB.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(result.authenticationInfo.newCounter, stored.id).run();
		return true;
	} catch {
		return false;
	}
}
