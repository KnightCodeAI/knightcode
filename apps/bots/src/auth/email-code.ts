// Sign-in with a one-time email code (spec section 4): six digits, good for ten minutes and five tries. Only a keyed
// hash of the code is stored; a new request replaces the old code.
import type { Env } from "../env.ts";
import { accountForIdentity } from "./accounts.ts";
import { hmac } from "./util.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
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
	await env.DB.prepare(
		"INSERT INTO email_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) " +
			"ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0",
	)
		.bind(address, await codeHash(env, address, code), Date.now() + CODE_TTL_MS)
		.run();
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
	const row = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ?")
		.bind(address)
		.first<{ code_hash: string; expires_at: number; attempts: number }>();
	if (!row) return undefined;
	if (row.expires_at <= Date.now() || row.attempts >= MAX_ATTEMPTS) {
		await env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(address).run();
		return undefined;
	}
	if (!/^\d{6}$/.test(code) || (await codeHash(env, address, code)) !== row.code_hash) {
		await env.DB.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?").bind(address).run();
		return undefined;
	}
	// Spent before signing in, so a code works once even when two requests race.
	const spent = await env.DB.prepare("DELETE FROM email_codes WHERE email = ? AND code_hash = ?")
		.bind(address, row.code_hash)
		.run();
	if (spent.meta.changes !== 1) return undefined;
	const account = await accountForIdentity(env.DB, { provider: "email", subject: address, email: address, emailVerified: true });
	return account.accountId;
}
