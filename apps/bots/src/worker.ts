import { CLEAR_SESSION_COOKIE, issueSession, readSession, revokeSession, sessionCookie } from "./auth/session.ts";
import { sendEmailCode, TooManyCodes, verifyEmailCode } from "./auth/email-code.ts";
import { completeOAuth, startOAuth } from "./auth/oauth.ts";
import { beginPasskey, finishPasskey } from "./auth/passkeys.ts";
import { issueTicket } from "./auth/tickets.ts";
import type { Principal } from "./auth/session.ts";
import { safeNext } from "./auth/util.ts";
import { verifyScreenToken } from "./computer/screens.ts";
import { indexPlugins } from "./connectors/plugin-indexer.ts";
import { consumeOutbound } from "./delivery/queue.ts";
import type { Env, OutboundMessage } from "./env.ts";
import { matchRoute, parse, ProtocolError, queryToRequest, type RouteName, type RouteRequest, type RouteResponse } from "@knightcode/bots-protocol";

export { BotObject } from "./bot/bot-object.ts";
export { ComputerObject } from "./computer/computer-object.ts";
export { UserObject } from "./user/user-object.ts";

const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });

/**
 * Cookie-authenticated state changes must come from this site (spec section 15): a page on another origin can make the
 * browser send our cookie, but not forge its Origin header.
 */
function crossOrigin(request: Request): boolean {
	// Sockets authenticate in band (a ticket in the first frame, or a screen capability), never with the cookie, so
	// the desktop app's renderer and native clients, whose Origin is not this site, can open them.
	if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return false;
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
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
		} catch (error) {
			if (error instanceof TooManyCodes) return json({ error: "too_many_codes" }, 429);
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

/** The signed-in account's user object. */
const userOf = (env: Env, principal: Principal) => env.USER.get(env.USER.idFromName(principal.accountId));

type Handler<N extends RouteName> = (env: Env, principal: Principal, request: RouteRequest<N>) => Promise<RouteResponse<N>>;

/** The API routes served so far; the rest of the contract answers 404 until its task lands. */
const HANDLERS: { [N in RouteName]?: Handler<N> } = {
	issueTicket: async (env, principal, { scope }) => {
		const ttlMs = 60_000;
		return { ticket: await issueTicket(env, principal, scope, ttlMs), expiresAt: Date.now() + ttlMs };
	},
	listVault: async (env, principal) => ({ items: await userOf(env, principal).vaultList() }),
	putVault: async (env, principal, item) => userOf(env, principal).vaultPut(item),
	deleteVault: async (env, principal, { id }) => {
		await userOf(env, principal).vaultDelete(id);
		return { ok: true as const };
	},
};

async function api(request: Request, env: Env, pathname: string): Promise<Response> {
	const match = matchRoute(request.method, pathname);
	const handler = match && (HANDLERS[match.route.name] as Handler<RouteName> | undefined);
	if (!match || !handler) return json({ error: "not_found" }, 404);
	const principal = await readSession(env, request);
	if (!principal) return json({ error: "unauthorized" }, 401);
	const body =
		request.method === "GET" || request.method === "DELETE"
			? queryToRequest(match.route, new URL(request.url).searchParams)
			: ((await request.json().catch(() => ({}))) as Record<string, unknown>);
	let input: RouteRequest<RouteName>;
	try {
		input = parse(match.route.request, { ...body, ...match.params }) as RouteRequest<RouteName>;
	} catch (error) {
		return json({ error: "bad_request", path: error instanceof ProtocolError ? error.path : "" }, 400);
	}
	try {
		return json(await handler(env, principal, input));
	} catch (error) {
		console.error("api", match.route.name, error);
		return json({ error: "failed" }, 500);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/health") return json({ ok: true });
		const isApi = pathname === "/api" || pathname.startsWith("/api/");
		const isAuth = pathname.startsWith("/auth/");
		if ((isApi || isAuth) && crossOrigin(request)) return json({ error: "forbidden_origin" }, 403);
		if (isAuth) return auth(request, env, pathname);
		// A screen: the token in the URL is the capability; its account picks the computer, which checks it fully.
		const screen = /^\/api\/computer\/screen\/([^/]+)$/.exec(pathname);
		if (screen && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const grant = await verifyScreenToken(env.SESSION_SECRET, screen[1]!);
			if (!grant) return json({ error: "expired" }, 403);
			return env.COMPUTER.get(env.COMPUTER.idFromName(grant.accountId)).fetch(request);
		}
		// A bot's live socket: the bot object checks the ticket in its first frame.
		const socket = /^\/api\/bots\/([^/]+)\/socket$/.exec(pathname);
		if (socket && request.headers.get("upgrade")?.toLowerCase() === "websocket")
			return env.BOT.get(env.BOT.idFromName(decodeURIComponent(socket[1]!))).fetch(request);
		if (isApi) return api(request, env, pathname);
		return env.ASSETS.fetch(request);
	},
	queue: (batch, env) => consumeOutbound(batch, env),
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(indexPlugins(env).catch((error: unknown) => console.error("plugin index", error)));
	},
} satisfies ExportedHandler<Env, OutboundMessage>;
