// Sign-in with GitHub or Google (spec sections 4 and 21). The state is random, kept server-side for ten minutes,
// bound to the browser by a cookie and used once, so no one can finish a sign-in started in another browser (login
// CSRF). Tests point the endpoints at the emulators through EMULATE_GITHUB_URL and EMULATE_GOOGLE_URL.
import type { Env } from "../env.ts";
import { accountForIdentity, handleOf } from "./accounts.ts";
import { issueSession, sessionCookie } from "./session.ts";
import { cookie, randomToken, readCookie, safeNext } from "./util.ts";

export type OAuthProvider = "github" | "google";

const STATE_COOKIE = "kb_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

interface Endpoints {
	authorize: string;
	token: string;
	profile: string;
	emails?: string;
	scope: string;
	clientId: string;
	clientSecret: string;
}

function endpoints(env: Env, provider: OAuthProvider): Endpoints {
	if (provider === "github") {
		const web = env.EMULATE_GITHUB_URL ?? "https://github.com";
		const api = env.EMULATE_GITHUB_URL ?? "https://api.github.com";
		return {
			authorize: `${web}/login/oauth/authorize`,
			token: `${web}/login/oauth/access_token`,
			profile: `${api}/user`,
			emails: `${api}/user/emails`,
			scope: "read:user user:email",
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
		};
	}
	const emulator = env.EMULATE_GOOGLE_URL;
	return {
		authorize: `${emulator ?? "https://accounts.google.com"}/o/oauth2/v2/auth`,
		token: emulator ? `${emulator}/oauth2/token` : "https://oauth2.googleapis.com/token",
		profile: emulator ? `${emulator}/oauth2/v2/userinfo` : "https://openidconnect.googleapis.com/v1/userinfo",
		scope: "openid email profile",
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
	};
}

/** This site's origin, which every callback URL and passkey check uses. */
export const appOrigin = (env: Env) => env.APP_ORIGIN ?? "https://bots.knightcode.dev";

const callbackUrl = (env: Env, provider: OAuthProvider) => `${appOrigin(env)}/auth/${provider}/callback`;

/** Sends the browser to the provider's consent page; `next` is where to land afterwards (this site only). */
export async function startOAuth(env: Env, provider: OAuthProvider, next: string): Promise<Response> {
	const config = endpoints(env, provider);
	const state = randomToken(24);
	await env.DB.prepare("INSERT INTO oauth_states (state, provider, next, created_at) VALUES (?, ?, ?, ?)")
		.bind(state, provider, safeNext(next), Date.now())
		.run();
	const url = new URL(config.authorize);
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("redirect_uri", callbackUrl(env, provider));
	url.searchParams.set("scope", config.scope);
	url.searchParams.set("state", state);
	if (provider === "google") url.searchParams.set("response_type", "code");
	const headers = new Headers({ location: url.toString() });
	headers.append("set-cookie", cookie(STATE_COOKIE, state, { path: "/auth", maxAgeSeconds: STATE_TTL_MS / 1000 }));
	return new Response(null, { status: 302, headers });
}

/** Where a failed sign-in lands; the reason is a short code, never a provider's message. */
function failed(reason: string): Response {
	const headers = new Headers({ location: `/signin?error=${reason}` });
	headers.append("set-cookie", cookie(STATE_COOKIE, "", { path: "/auth", maxAgeSeconds: 0 }));
	return new Response(null, { status: 302, headers });
}

/**
 * The provider's redirect back: checks and spends the state, trades the code for a token, reads the profile, signs
 * the account in (creating it on first sign-in) and sends a new account to choose its handle.
 */
export async function completeOAuth(env: Env, request: Request): Promise<Response> {
	const url = new URL(request.url);
	const provider = url.pathname.split("/")[2] as OAuthProvider;
	if (provider !== "github" && provider !== "google") return failed("provider");
	const state = url.searchParams.get("state") ?? "";
	const code = url.searchParams.get("code") ?? "";
	if (!state || !code || readCookie(request, STATE_COOKIE) !== state) return failed("state");
	const stored = await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? AND provider = ? RETURNING next, created_at")
		.bind(state, provider)
		.first<{ next: string; created_at: number }>();
	if (!stored || Date.now() - stored.created_at > STATE_TTL_MS) return failed("state");

	const config = endpoints(env, provider);
	const token = await fetch(config.token, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: callbackUrl(env, provider),
			grant_type: "authorization_code",
		}),
	});
	const grant = (await token.json().catch(() => ({}))) as { access_token?: string };
	if (!token.ok || !grant.access_token) return failed("token");
	const auth = { authorization: `Bearer ${grant.access_token}`, accept: "application/json", "user-agent": "KnightCode Bots" };

	const profileResponse = await fetch(config.profile, { headers: auth });
	if (!profileResponse.ok) return failed("profile");
	const profile = (await profileResponse.json()) as Record<string, unknown>;
	let identity: { subject: string; email?: string; emailVerified: boolean; name?: string };
	if (provider === "github") {
		const emails = config.emails ? await fetch(config.emails, { headers: auth }) : undefined;
		const list = emails?.ok ? ((await emails.json()) as { email: string; primary: boolean; verified: boolean }[]) : [];
		const primary = list.find((entry) => entry.primary) ?? list[0];
		identity = {
			subject: String(profile.id),
			email: primary?.email,
			emailVerified: primary?.verified === true,
			name: typeof profile.name === "string" ? profile.name : String(profile.login ?? ""),
		};
	} else {
		identity = {
			subject: String(profile.sub ?? profile.id),
			email: typeof profile.email === "string" ? profile.email : undefined,
			emailVerified: profile.email_verified === true || profile.verified_email === true,
			name: typeof profile.name === "string" ? profile.name : undefined,
		};
	}
	if (!identity.subject || identity.subject === "undefined") return failed("profile");

	const account = await accountForIdentity(env.DB, { provider, ...identity });
	const session = await issueSession(env, account.accountId, "web");
	const handle = await handleOf(env.DB, account.accountId);
	const next = handle ? stored.next : `/handle?next=${encodeURIComponent(stored.next)}`;
	const headers = new Headers({ location: next });
	headers.append("set-cookie", sessionCookie(session));
	headers.append("set-cookie", cookie(STATE_COOKIE, "", { path: "/auth", maxAgeSeconds: 0 }));
	return new Response(null, { status: 302, headers });
}
