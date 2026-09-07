import { type Env, issueCliToken } from "./accounts.ts";
import { randomId, sha256Hex, sign, verify } from "./crypto.ts";

const DEVICE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 5;
/** Excludes vowels and lookalikes so a spoken or mistyped code fails fast. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

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
	return json({
		device_code: deviceCode,
		user_code: code,
		verification_uri: `${new URL(request.url).origin}/device`,
		interval: POLL_INTERVAL_SECONDS,
		expires_in: Math.floor(DEVICE_TTL_MS / 1000),
	});
}

export async function csrfToken(env: Env, accountId: string): Promise<string> {
	return sign(env.SIGNING_SECRET, `csrf:${accountId}`);
}

export async function approveDevice(env: Env, request: Request, accountId: string): Promise<Response> {
	const form = await request.formData();
	const submitted = String(form.get("csrf") ?? "");
	if ((await verify(env.SIGNING_SECRET, submitted)) !== `csrf:${accountId}`) {
		return new Response("Invalid request token", { status: 403 });
	}
	const code = String(form.get("user_code") ?? "")
		.trim()
		.toUpperCase();
	const result = await env.DB.prepare(
		"UPDATE device_codes SET account_id = ?, approved_at = ? WHERE user_code = ? AND approved_at IS NULL AND expires_at > ?",
	)
		.bind(accountId, Date.now(), code, Date.now())
		.run();
	if (!result.meta.changes) return new Response("That code is not valid any more", { status: 400 });
	return new Response("Device approved. Return to your terminal.", { headers: { "content-type": "text/plain" } });
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
