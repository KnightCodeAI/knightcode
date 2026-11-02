// Sign-in with a one-time email code (spec section 4): six digits, good for ten minutes. Only a keyed hash of the code
// is stored; a new request replaces the old code. At most one code a minute and five an hour per address, and five
// wrong tries per hour whatever the number of codes: each try is counted atomically before it is compared.
import type { Env } from "../env.ts";
import { accountForIdentity } from "./accounts.ts";
import { hmac } from "./util.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60_000;
const SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export class TooManyCodes extends Error {
	constructor() {
		super("too many codes; wait a little before asking again");
		this.name = "TooManyCodes";
	}
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalize = (email: string) => email.trim().toLowerCase();
const codeHash = (env: Env, email: string, code: string) => hmac(env.SESSION_SECRET, `email-code:${email}:${code}`);

/** Six uniformly random digits (rejection sampling, so no digit is likelier than another). */
function sixDigits(): string {
	const limit = 4_294_000_000; // the largest multiple of 1,000,000 below 2^32
	for (;;) {
		const [value] = crypto.getRandomValues(new Uint32Array(1));
		if (value! < limit) return String(value! % 1_000_000).padStart(6, "0");
	}
}

/** Sends a new code to `email`. Throws on an address that is not one. */
export async function sendEmailCode(env: Env, email: string): Promise<void> {
	const address = normalize(email);
	if (!EMAIL.test(address)) throw new Error("not an email address");
	// The outbound mail binding arrives with the email channel (Task 3.5); without it no code could reach anyone.
	if (!env.EMAIL) throw new Error("email sending is not set up");
	const code = sixDigits();
	const now = Date.now();
	// One statement decides and records the send: a fresh hour starts the counts over; otherwise it is refused when the
	// last code is under a minute old or the hour's five are used. Attempts carry over within the hour.
	const stored = await env.DB.prepare(
		`INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_at, sends, window_start) VALUES (?1, ?2, ?3, 0, ?4, 1, ?4)
		 ON CONFLICT (email) DO UPDATE SET
		   code_hash = excluded.code_hash,
		   expires_at = excluded.expires_at,
		   attempts = CASE WHEN email_codes.window_start <= ?4 - ?5 THEN 0 ELSE email_codes.attempts END,
		   sends = CASE WHEN email_codes.window_start <= ?4 - ?5 THEN 1 ELSE email_codes.sends + 1 END,
		   window_start = CASE WHEN email_codes.window_start <= ?4 - ?5 THEN ?4 ELSE email_codes.window_start END,
		   sent_at = ?4
		 WHERE email_codes.sent_at <= ?4 - ?6 AND (email_codes.window_start <= ?4 - ?5 OR email_codes.sends < ?7)
		 RETURNING email`,
	)
		.bind(address, await codeHash(env, address, code), now + CODE_TTL_MS, now, HOUR_MS, RESEND_AFTER_MS, SENDS_PER_HOUR)
		.first<{ email: string }>();
	if (!stored) throw new TooManyCodes();
	await env.EMAIL.send({
		to: address,
		from: "KnightCode Bots <signin@bots.knightcode.dev>",
		subject: `${code} is your KnightCode Bots sign-in code`,
		text: `Your sign-in code is ${code}. It works for 10 minutes. If you did not ask for it, ignore this email.`,
	});
}

/** The account the code signs into (created on first sign-in), or undefined for a wrong, used or expired code. */
export async function verifyEmailCode(env: Env, email: string, code: string): Promise<string | undefined> {
	const address = normalize(email);
	if (!/^\d{6}$/.test(code)) return undefined;
	// The try is counted before the code is compared, in one statement: concurrent guesses each use one of the five.
	const row = await env.DB.prepare(
		"UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND attempts < ? AND expires_at > ? RETURNING code_hash",
	)
		.bind(address, MAX_ATTEMPTS, Date.now())
		.first<{ code_hash: string }>();
	if (!row) return undefined;
	if ((await codeHash(env, address, code)) !== row.code_hash) return undefined;
	// Spent before signing in, so a code works once even when two requests race.
	const spent = await env.DB.prepare("DELETE FROM email_codes WHERE email = ? AND code_hash = ?")
		.bind(address, row.code_hash)
		.run();
	if (spent.meta.changes !== 1) return undefined;
	const account = await accountForIdentity(env.DB, { provider: "email", subject: address, email: address, emailVerified: true });
	return account.accountId;
}
