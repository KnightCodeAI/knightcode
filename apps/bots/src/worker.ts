import { CLEAR_SESSION_COOKIE, issueSession, readSession, revokeSession, sessionCookie } from "./auth/session.ts";
import { sendEmailCode, TooManyCodes, verifyEmailCode } from "./auth/email-code.ts";
import { completeOAuth, startOAuth } from "./auth/oauth.ts";
import { beginPasskey, finishPasskey } from "./auth/passkeys.ts";
import { issueTicket } from "./auth/tickets.ts";
import { StripeBilling } from "./billing/stripe.ts";
import { billingChanges, type StripeEvent, verifyStripeSignature } from "./billing/webhooks.ts";
import type { Principal } from "./auth/session.ts";
import { safeNext } from "./auth/util.ts";
import { verifyScreenToken } from "./computer/screens.ts";
import { indexPlugins } from "./connectors/plugin-indexer.ts";
import { recordBounce, recordCorrespondent } from "./channels/email.ts";
import { consumeLinkCode, linkFor } from "./channels/linking.ts";
import { slackDirectMessages } from "./channels/slack.ts";
import { telegramChannel, telegramNotice } from "./channels/telegram.ts";
import { addressOf } from "./routines/email-trigger.ts";
import { consumeOutbound } from "./delivery/queue.ts";
import { composioAdapter } from "./routines/composio-events.ts";
import { type InboundMail, mailEvent } from "./routines/email-trigger.ts";
import { githubAdapter } from "./routines/github-app.ts";
import { slackAdapter, verifySlack } from "./routines/slack-events.ts";
import { dispatchEvent, type TriggerAdapter, type TriggerEvent } from "./routines/triggers.ts";
import { webhookAdapter } from "./routines/webhook.ts";
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

/** Inbound trigger events (spec section 12): each source's signature is checked before anything is read. */
async function hooks(request: Request, env: Env, pathname: string): Promise<Response> {
	if (request.method !== "POST") return json({ error: "not_found" }, 404);
	const run = async (adapter: Pick<TriggerAdapter<never>, "verify">, prepare?: (event: TriggerEvent) => Promise<TriggerEvent | undefined>) => {
		const verified = await adapter.verify(request, env);
		if (verified === undefined) return json({ error: "unauthorized" }, 401);
		let fired = 0;
		for (const raw of Array.isArray(verified) ? verified : [verified]) {
			const event = prepare ? await prepare(raw) : raw;
			if (event) fired += await dispatchEvent(env, event, event.kind === "slack" ? slackOwner(env, event) : undefined);
		}
		return json({ ok: true, fired });
	};
	if (pathname === "/hooks/stripe") {
		const body = await request.text();
		if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature"), body)))
			return json({ error: "unauthorized" }, 401);
		const stripe = new StripeBilling({ secretKey: env.STRIPE_SECRET_KEY ?? "", apiUrl: env.STRIPE_API_URL });
		const result = await billingChanges(JSON.parse(body) as StripeEvent, { fee: (intent) => stripe.fee(intent) });
		if (result) await env.USER.get(env.USER.idFromName(result.accountId)).applyBilling(result.changes);
		return json({ ok: true });
	}
	if (pathname === "/hooks/github") return run(githubAdapter);
	if (pathname === "/hooks/telegram") {
		const messages = await telegramChannel.verify(request, env);
		if (messages === undefined) return json({ error: "unauthorized" }, 401);
		for (const message of messages) {
			const link = await linkFor(env.DB, "telegram", message.externalChat);
			if (link) {
				// Group chats (negative ids) carry other people's words: outside text.
				await env.BOT.get(env.BOT.idFromName(link.botId)).channelMessage(link, message, { outside: message.externalChat.startsWith("-") });
				continue;
			}
			const linked = await consumeLinkCode(env.DB, { channel: "telegram", code: message.text, externalChat: message.externalChat });
			await telegramNotice(
				env,
				message.externalChat,
				linked ? "Linked. Your messages here now go to your bot." : "Send the link code shown in KnightCode Bots, Settings, Chat apps.",
			);
		}
		return json({ ok: true });
	}
	if (pathname === "/hooks/slack") {
		// Slack's endpoint check is answered only on a correctly signed request.
		const body = await verifySlack(request.clone(), env.SLACK_SIGNING_SECRET);
		if (body === undefined) return json({ error: "unauthorized" }, 401);
		const parsed = JSON.parse(body) as { type?: string; challenge?: string };
		if (parsed.type === "url_verification") return json({ challenge: parsed.challenge });
		// The user's DMs with the app go to the bot they linked ("Link DMs").
		for (const message of slackDirectMessages(body)) {
			const link = await linkFor(env.DB, "slack", message.externalChat);
			if (link) await env.BOT.get(env.BOT.idFromName(link.botId)).channelMessage(link, message, { outside: false });
		}
		return run(slackAdapter);
	}
	if (pathname === "/hooks/composio")
		return run(composioAdapter, async (event) => {
			// The connected account says whose app it is.
			const owner = await env.DB.prepare("SELECT account_id, app_id FROM composio_accounts WHERE connected_account_id = ?")
				.bind(event.routeKey)
				.first<{ account_id: string; app_id: string }>();
			return owner ? { ...event, routeKey: `${owner.account_id}:${owner.app_id.toLowerCase()}` } : undefined;
		});
	if (pathname.startsWith("/hooks/w/")) return run(webhookAdapter);
	return json({ error: "not_found" }, 404);
}

/** The account's own Slack user in the event's workspace, for "only my reactions". */
const slackOwner = (env: Env, event: TriggerEvent) => async (accountId: string) => {
	const row = await env.DB.prepare("SELECT owner_user_id FROM slack_teams WHERE team_id = ? AND account_id = ?")
		.bind(event.routeKey, accountId)
		.first<{ owner_user_id: string | null }>();
	return { owner: row?.owner_user_id ?? undefined };
};

/**
 * Mail to a bot's address (Cloudflare Email Routing). Bounce reports count against the account's sending health. The
 * sender becomes a correspondent (replies to them are not capped). Matching email routines fire; otherwise the mail goes
 * to the bot's thread, as outside text unless it is from the owner's own address, and the bot's answer is a reply.
 */
export async function receiveEmail(env: Env, mail: InboundMail): Promise<number> {
	const to = addressOf(mail.to);
	const bot = await env.DB.prepare("SELECT bot_id, account_id FROM bot_addresses WHERE address = ?").bind(to).first<{ bot_id: string; account_id: string }>();
	if (!bot) return 0;
	const from = addressOf(mail.from);
	if (/^(mailer-daemon|postmaster)@/i.test(from) || /multipart\/report/i.test(mail.headers.get("content-type") ?? "")) {
		await recordBounce(env.DB, bot.account_id);
		return 0;
	}
	await recordCorrespondent(env.DB, bot.account_id, from);
	const fired = await dispatchEvent(env, mailEvent(mail));
	if (fired > 0) return fired;
	const owner = await env.DB.prepare("SELECT email FROM accounts WHERE id = ?").bind(bot.account_id).first<{ email: string | null }>();
	const messageId = mail.headers.get("message-id") ?? undefined;
	const references = (mail.headers.get("references") ?? "").split(/\s+/).filter(Boolean);
	await env.BOT.get(env.BOT.idFromName(bot.bot_id)).channelMessage(
		{ channel: "email", externalChat: from, accountId: bot.account_id, botId: bot.bot_id, mode: "direct" },
		{
			channel: "email",
			externalChat: from,
			externalUser: from,
			text: mail.text,
			...(messageId ? { messageId } : {}),
			references,
			subject: mail.headers.get("subject") ?? "",
		},
		{ outside: owner?.email?.toLowerCase() !== from },
	);
	return 0;
}

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/health") return json({ ok: true });
		const isApi = pathname === "/api" || pathname.startsWith("/api/");
		const isAuth = pathname.startsWith("/auth/");
		if ((isApi || isAuth) && crossOrigin(request)) return json({ error: "forbidden_origin" }, 403);
		if (isAuth) return auth(request, env, pathname);
		if (pathname.startsWith("/hooks/")) return hooks(request, env, pathname);
		// A screen: the token in the URL is the capability; its account picks the computer, which checks it fully.
		const screen = /^\/api\/computer\/screen\/([^/]+)$/.exec(pathname);
		if (screen && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const grant = await verifyScreenToken(env.SESSION_SECRET, screen[1]!);
			if (!grant) return json({ error: "expired" }, 403);
			return env.COMPUTER.get(env.COMPUTER.idFromName(grant.accountId)).fetch(request);
		}
		// The desktop app's computer link: the account's user object checks the ticket in its first frame.
		const desktop = /^\/api\/desktop\/([^/]+)\/link$/.exec(pathname);
		if (desktop && request.headers.get("upgrade")?.toLowerCase() === "websocket")
			return env.USER.get(env.USER.idFromName(decodeURIComponent(desktop[1]!))).fetch(request);
		// A bot's live socket: the bot object checks the ticket in its first frame.
		const socket = /^\/api\/bots\/([^/]+)\/socket$/.exec(pathname);
		if (socket && request.headers.get("upgrade")?.toLowerCase() === "websocket")
			return env.BOT.get(env.BOT.idFromName(decodeURIComponent(socket[1]!))).fetch(request);
		if (isApi) return api(request, env, pathname);
		return env.ASSETS.fetch(request);
	},
	queue: (batch, env) => consumeOutbound(batch, env),
	async email(message, env) {
		const text = await new Response(message.raw).text();
		await receiveEmail(env, { from: message.from, to: message.to, headers: message.headers, text: text.slice(0, 200_000) });
	},
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(indexPlugins(env).catch((error: unknown) => console.error("plugin index", error)));
	},
} satisfies ExportedHandler<Env, OutboundMessage>;
