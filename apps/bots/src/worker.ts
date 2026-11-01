import { DurableObject } from "cloudflare:workers";
import { CLEAR_SESSION_COOKIE, issueSession, readSession, revokeSession, sessionCookie } from "./auth/session.ts";
import { sendEmailCode, verifyEmailCode } from "./auth/email-code.ts";
import { completeOAuth, startOAuth } from "./auth/oauth.ts";
import { beginPasskey, finishPasskey } from "./auth/passkeys.ts";
import { issueTicket } from "./auth/tickets.ts";
import { safeNext } from "./auth/util.ts";
import type { Env } from "./env.ts";

// Empty shells; Parts 2 and 3 fill them in.
export class BotObject extends DurableObject<Env> {}
export class UserObject extends DurableObject<Env> {}
export class ComputerObject extends DurableObject<Env> {}

const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });

/**
 * Cookie-authenticated state changes and WebSocket upgrades must come from this site (spec section 15): a page on
 * another origin can make the browser send our cookie, but not forge its Origin header.
 */
function crossOrigin(request: Request): boolean {
	const stateChanging = !["GET", "HEAD", "OPTIONS"].includes(request.method);
	const upgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
	if (!stateChanging && !upgrade) return false;
	return request.headers.get("origin") !== new URL(request.url).origin;
}

/** Signs the account in: a session cookie and a JSON answer the page follows. */
async function signedIn(env: Env, accountId: string, next = "/"): Promise<Response> {
	const token = await issueSession(env, accountId, "web");
	return json({ ok: true, next: safeNext(next) }, 200, { "set-cookie": sessionCookie(token) });
}

async function auth(request: Request, env: Env, pathname: string): Promise<Response> {
	const url = new URL(request.url);
	const provider = pathname.split("/")[2];
	if (request.method === "GET" && (provider === "github" || provider === "google")) {
		if (pathname === `/auth/${provider}`) return startOAuth(env, provider, url.searchParams.get("next") ?? "/");
		if (pathname === `/auth/${provider}/callback`) return completeOAuth(env, request);
	}
	if (request.method === "POST" && pathname === "/auth/email") {
		const { email } = (await request.json().catch(() => ({}))) as { email?: string };
		if (typeof email !== "string") return json({ error: "bad_request" }, 400);
		try {
			await sendEmailCode(env, email);
		} catch {
			return json({ error: "email_unavailable" }, 400);
		}
		return json({ ok: true });
	}
	if (request.method === "POST" && pathname === "/auth/email/verify") {
		const { email, code, next } = (await request.json().catch(() => ({}))) as { email?: string; code?: string; next?: string };
		const accountId = typeof email === "string" && typeof code === "string" ? await verifyEmailCode(env, email, code) : undefined;
		return accountId ? signedIn(env, accountId, next) : json({ error: "invalid_code" }, 401);
	}
	if (request.method === "POST" && pathname === "/auth/passkey/options") {
		const principal = await readSession(env, request);
		return json(await beginPasskey(env, principal?.accountId));
	}
	if (request.method === "POST" && pathname === "/auth/passkey") {
		const accountId = await finishPasskey(env, await request.json().catch(() => undefined));
		return accountId ? signedIn(env, accountId) : json({ error: "invalid_passkey" }, 401);
	}
	if (request.method === "POST" && pathname === "/auth/sign-out") {
		await revokeSession(env, request);
		return json({ ok: true }, 200, { "set-cookie": CLEAR_SESSION_COOKIE });
	}
	return json({ error: "not_found" }, 404);
}

async function api(request: Request, env: Env, pathname: string): Promise<Response> {
	if (request.method === "POST" && pathname === "/api/tickets") {
		const principal = await readSession(env, request);
		if (!principal) return json({ error: "unauthorized" }, 401);
		const { scope } = (await request.json().catch(() => ({}))) as { scope?: string };
		if (scope !== "socket" && scope !== "screen") return json({ error: "bad_request" }, 400);
		const ttlMs = 60_000;
		return json({ ticket: await issueTicket(env, principal, scope, ttlMs), expiresAt: Date.now() + ttlMs });
	}
	return json({ error: "not_found" }, 404);
}

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/health") return json({ ok: true });
		const isApi = pathname === "/api" || pathname.startsWith("/api/");
		const isAuth = pathname.startsWith("/auth/");
		if ((isApi || isAuth) && crossOrigin(request)) return json({ error: "forbidden_origin" }, 403);
		if (isAuth) return auth(request, env, pathname);
		if (isApi) return api(request, env, pathname);
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
