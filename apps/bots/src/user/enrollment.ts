// "Connect to KnightCode Bots" (spec section 4): the desktop app runs a fresh sign-in per provider and hands the cloud
// the result with a one-time enrollment token: good for ten minutes, for one provider, used once.
import { randomToken, sha256 } from "../auth/util.ts";

const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

export function createEnrollmentTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS enrollments (
		token_hash TEXT PRIMARY KEY,
		provider TEXT NOT NULL,
		expires_at INTEGER NOT NULL
	)`);
}

export async function beginEnrollment(sql: SqlStorage, provider: string): Promise<{ token: string; expiresAt: number }> {
	const token = randomToken(32);
	const expiresAt = Date.now() + ENROLLMENT_TTL_MS;
	sql.exec("DELETE FROM enrollments WHERE expires_at <= ?", Date.now());
	sql.exec("INSERT INTO enrollments (token_hash, provider, expires_at) VALUES (?, ?, ?)", await sha256(token), provider, expiresAt);
	return { token, expiresAt };
}

/** The provider the token was issued for, spending the token; undefined for an unknown, used or expired one. */
export async function spendEnrollment(sql: SqlStorage, token: string): Promise<string | undefined> {
	const hash = await sha256(token);
	const row = sql
		.exec<{ provider: string; expires_at: number }>("SELECT provider, expires_at FROM enrollments WHERE token_hash = ?", hash)
		.toArray()[0];
	sql.exec("DELETE FROM enrollments WHERE token_hash = ?", hash);
	if (!row || row.expires_at <= Date.now()) return undefined;
	return row.provider;
}
