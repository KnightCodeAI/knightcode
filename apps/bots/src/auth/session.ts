// Web sessions (spec section 15): an HttpOnly, Secure, SameSite=Lax cookie holding a random token. Only the token's
// SHA-256 is stored, and revoking a session ends it at once.
import type { Env } from "../env.ts";
import { accountById } from "./accounts.ts";
import { cookie, randomToken, readCookie, sha256 } from "./util.ts";

export const SESSION_COOKIE = "kb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Who is making a request: the account, its workspace, and which client. Checked against every object. */
export type Principal = {
	accountId: string;
	workspaceId: string;
	client: "web" | "desktop" | "cli";
	/** The session this principal came from (its stored id); tickets and sockets end when it is revoked. */
	sessionId?: string;
};

/** A new session for the account; the returned token goes in the cookie and nowhere else. */
export async function issueSession(env: Env, accountId: string, client: Principal["client"] = "web"): Promise<string> {
	const account = await accountById(env.DB, accountId);
	if (!account) throw new Error("no such account");
	const token = randomToken(32);
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO sessions (id, account_id, workspace_id, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
	)
		.bind(await sha256(token), accountId, account.workspaceId, client, now, now + SESSION_TTL_MS)
		.run();
	return token;
}

/** The Set-Cookie value for a session token. */
export function sessionCookie(token: string): string {
	return cookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_MS / 1000 });
}

/** The Set-Cookie value that clears the session cookie. */
export const CLEAR_SESSION_COOKIE = cookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 });

/** The principal behind the request's session cookie, if it is live. */
export async function readSession(env: Env, request: Request): Promise<Principal | undefined> {
	const token = readCookie(request, SESSION_COOKIE);
	if (!token) return undefined;
	const sessionId = await sha256(token);
	const row = await env.DB.prepare(
		"SELECT account_id, workspace_id, client FROM sessions WHERE id = ? AND expires_at > ? AND revoked_at IS NULL",
	)
		.bind(sessionId, Date.now())
		.first<{ account_id: string; workspace_id: string; client: Principal["client"] }>();
	return row ? { accountId: row.account_id, workspaceId: row.workspace_id, client: row.client, sessionId } : undefined;
}

/** Whether the session is still live: not expired and not revoked. */
export async function sessionLive(env: Env, sessionId: string): Promise<boolean> {
	const row = await env.DB.prepare("SELECT 1 AS live FROM sessions WHERE id = ? AND expires_at > ? AND revoked_at IS NULL")
		.bind(sessionId, Date.now())
		.first<{ live: number }>();
	return row !== null;
}

/** Ends the request's session, if any. */
export async function revokeSession(env: Env, request: Request): Promise<void> {
	const token = readCookie(request, SESSION_COOKIE);
	if (!token) return;
	await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(Date.now(), await sha256(token)).run();
}
