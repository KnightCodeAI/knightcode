import { type Env, issueSessionCookie, readCookie, upsertAccount } from "./accounts.ts";
import { randomId } from "./crypto.ts";

/**
 * Binds a callback to the browser that started the login. A state that was only the return
 * path let anyone hand a victim a callback carrying the attacker's own GitHub code, signing
 * that browser into the attacker's account, where /device would then approve the victim's
 * terminal into it. The nonce is the state's prefix and this cookie's value; the callback
 * refuses a state this browser did not start.
 */
const STATE_COOKIE = "kc_oauth_state";
const STATE_MAX_AGE_SECONDS = 10 * 60;

/** Only same-origin absolute paths are accepted, so `next` cannot become an open redirect. */
function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
	return raw;
}

function stateCookie(value: string, maxAge: number): string {
	return `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=${maxAge}`;
}

export function startLogin(env: Env, url: URL): Response {
	const next = safeNext(url.searchParams.get("next"));
	const nonce = randomId(16);
	const authorize = new URL("https://github.com/login/oauth/authorize");
	authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
	authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
	authorize.searchParams.set("scope", "read:user");
	authorize.searchParams.set("state", `${nonce}${next}`);
	return new Response(null, {
		status: 302,
		headers: { location: authorize.toString(), "set-cookie": stateCookie(nonce, STATE_MAX_AGE_SECONDS) },
	});
}

export async function completeLogin(env: Env, request: Request): Promise<Response> {
	const url = new URL(request.url);
	const state = url.searchParams.get("state") ?? "";
	const nonce = readCookie(request, STATE_COOKIE);
	if (!nonce || !state.startsWith(nonce)) {
		return new Response("This sign-in was not started in this browser. Sign in again.", { status: 400 });
	}
	const code = url.searchParams.get("code");
	if (!code) return new Response("Missing code", { status: 400 });

	const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
			redirect_uri: `${url.origin}/auth/callback`,
		}),
	});
	const token = (await tokenResponse.json()) as { access_token?: string };
	if (!token.access_token) return new Response("GitHub rejected the authorization", { status: 401 });

	const userResponse = await fetch("https://api.github.com/user", {
		headers: {
			authorization: `Bearer ${token.access_token}`,
			accept: "application/vnd.github+json",
			"user-agent": "knightcode-remote",
		},
	});
	if (!userResponse.ok) return new Response("Could not read the GitHub profile", { status: 401 });
	const profile = (await userResponse.json()) as { id: number; login: string; avatar_url?: string };

	const account = await upsertAccount(env.DB, "github", String(profile.id), profile.login, profile.avatar_url ?? null);
	const headers = new Headers({ location: safeNext(state.slice(nonce.length)) });
	headers.append("set-cookie", await issueSessionCookie(env.SIGNING_SECRET, account.id));
	headers.append("set-cookie", stateCookie("", 0));
	return new Response(null, { status: 302, headers });
}
