import { type Env, issueCliToken } from "./accounts.ts";
import { randomId, sha256Hex, sign, verify } from "./crypto.ts";

const DEVICE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 5;
/** Excludes vowels and lookalikes so a spoken or mistyped code fails fast. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
/** What a code may look like before it is reflected back into a redirect url. */
const USER_CODE_SHAPE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function userCode(): string {
	const raw = crypto.getRandomValues(new Uint8Array(8));
	const characters = [...raw].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]);
	return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function startDevice(env: Env, request: Request): Promise<Response> {
	const deviceCode = randomId(32);
	const code = userCode();
	const now = Date.now();
	await env.DB.prepare(
		"INSERT INTO device_codes (device_code_hash, user_code, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(await sha256Hex(deviceCode), code, request.headers.get("x-knightcode-label") ?? "cli", now, now + DEVICE_TTL_MS)
		.run();
	const origin = new URL(request.url).origin;
	return json({
		device_code: deviceCode,
		user_code: code,
		verification_uri: `${origin}/device`,
		// RFC 8628 section 3.3.1. The code is prefilled, never auto-approved: a GET that
		// approved by itself would let any page the user visits authorise a terminal.
		verification_uri_complete: `${origin}/device?code=${encodeURIComponent(code)}`,
		interval: POLL_INTERVAL_SECONDS,
		expires_in: Math.floor(DEVICE_TTL_MS / 1000),
	});
}

export async function csrfToken(env: Env, accountId: string): Promise<string> {
	return sign(env.SIGNING_SECRET, `csrf:${accountId}`);
}

export async function approveDevice(env: Env, request: Request, accountId: string): Promise<Response> {
	const origin = new URL(request.url).origin;
	const form = await request.formData();
	const code = String(form.get("user_code") ?? "")
		.trim()
		.toUpperCase();
	const submitted = String(form.get("csrf") ?? "");
	if ((await verify(env.SIGNING_SECRET, submitted)) !== `csrf:${accountId}`) {
		// The token is minted per account when the page loads, so it stops matching whenever
		// the identity behind the tab changes underneath an open form — signing in again in
		// another tab, or a session that ended while this one sat there. The request is still
		// refused; it just goes back to the page, which mints a fresh token, instead of
		// dead-ending on plain text. The code rides along so the retry is one click.
		const carried = USER_CODE_SHAPE.test(code) ? `&code=${encodeURIComponent(code)}` : "";
		return new Response(null, { status: 303, headers: { location: `${origin}/device?stale=1${carried}` } });
	}
	const result = await env.DB.prepare(
		"UPDATE device_codes SET account_id = ?, approved_at = ? WHERE user_code = ? AND approved_at IS NULL AND expires_at > ?",
	)
		.bind(accountId, Date.now(), code, Date.now())
		.run();
	// Redirect rather than render: refreshing a rendered POST would repost the code, and
	// both outcomes are states of /device itself, so neither dead-ends on plain text.
	return new Response(null, {
		status: 303,
		headers: { location: `${origin}/device?${result.meta.changes ? "approved=1" : "invalid=1"}` },
	});
}

export async function pollDevice(env: Env, request: Request): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as { device_code?: unknown };
	if (typeof body.device_code !== "string") return json({ error: "invalid_request" }, 400);

	const hash = await sha256Hex(body.device_code);
	const row = await env.DB.prepare(
		"SELECT account_id, label, approved_at, consumed_at, expires_at FROM device_codes WHERE device_code_hash = ?",
	)
		.bind(hash)
		.first<{
			account_id: string | null;
			label: string | null;
			approved_at: number | null;
			consumed_at: number | null;
			expires_at: number;
		}>();

	if (!row || row.consumed_at !== null) return json({ error: "invalid_grant" }, 400);
	if (row.expires_at < Date.now()) return json({ error: "expired_token" }, 400);
	if (row.approved_at === null || !row.account_id) return json({ error: "authorization_pending" }, 200);

	// Mark consumed before issuing so a concurrent poll cannot mint a second token.
	const claim = await env.DB.prepare(
		"UPDATE device_codes SET consumed_at = ? WHERE device_code_hash = ? AND consumed_at IS NULL",
	)
		.bind(Date.now(), hash)
		.run();
	if (!claim.meta.changes) return json({ error: "invalid_grant" }, 400);

	return json({ token: await issueCliToken(env.DB, row.account_id, row.label ?? "cli") });
}
