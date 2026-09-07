import { randomId, sha256Hex, sign, verify } from "./crypto.ts";

export interface Env {
	DB: D1Database;
	ROOM: DurableObjectNamespace;
	ASSETS: Fetcher;
	SIGNING_SECRET: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
}

export interface Account {
	id: string;
	login: string;
	avatarUrl: string | null;
}

const SESSION_COOKIE = "kc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function upsertAccount(
	db: D1Database,
	provider: string,
	providerUserId: string,
	login: string,
	avatarUrl: string | null,
): Promise<Account> {
	await db
		.prepare(
			`INSERT INTO accounts (id, provider, provider_user_id, login, avatar_url, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (provider, provider_user_id)
			 DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url`,
		)
		.bind(randomId(16), provider, providerUserId, login, avatarUrl, Date.now())
		.run();
	const row = await db
		.prepare("SELECT id, login, avatar_url FROM accounts WHERE provider = ? AND provider_user_id = ?")
		.bind(provider, providerUserId)
		.first<{ id: string; login: string; avatar_url: string | null }>();
	if (!row) throw new Error("Account upsert did not persist");
	return { id: row.id, login: row.login, avatarUrl: row.avatar_url };
}

export async function issueSessionCookie(secret: string, accountId: string): Promise<string> {
	const signed = await sign(secret, accountId);
	return `${SESSION_COOKIE}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function readSessionCookie(secret: string, request: Request): Promise<string | undefined> {
	const header = request.headers.get("cookie");
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === SESSION_COOKIE) return verify(secret, rest.join("="));
	}
	return undefined;
}

export async function issueCliToken(db: D1Database, accountId: string, label: string): Promise<string> {
	const token = randomId(32);
	await db
		.prepare("INSERT INTO cli_tokens (id, account_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(randomId(16), accountId, await sha256Hex(token), label, Date.now())
		.run();
	return token;
}

export async function accountForCliToken(db: D1Database, token: string): Promise<string | undefined> {
	const row = await db
		.prepare("SELECT id, account_id FROM cli_tokens WHERE token_hash = ? AND revoked_at IS NULL")
		.bind(await sha256Hex(token))
		.first<{ id: string; account_id: string }>();
	if (!row) return undefined;
	await db.prepare("UPDATE cli_tokens SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.id).run();
	return row.account_id;
}

export async function revokeCliToken(db: D1Database, token: string): Promise<void> {
	await db
		.prepare("UPDATE cli_tokens SET revoked_at = ? WHERE token_hash = ?")
		.bind(Date.now(), await sha256Hex(token))
		.run();
}
