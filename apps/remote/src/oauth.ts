import { type Env, issueSessionCookie, upsertAccount } from "./accounts.ts";

/** Only same-origin absolute paths are accepted, so `next` cannot become an open redirect. */
function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
	return raw;
}

export function startLogin(env: Env, url: URL): Response {
	const next = safeNext(url.searchParams.get("next"));
	const authorize = new URL("https://github.com/login/oauth/authorize");
	authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
	authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
	authorize.searchParams.set("scope", "read:user");
	authorize.searchParams.set("state", next);
	return Response.redirect(authorize.toString(), 302);
}

export async function completeLogin(env: Env, url: URL): Promise<Response> {
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
	return new Response(null, {
		status: 302,
		headers: {
			location: safeNext(url.searchParams.get("state")),
			"set-cookie": await issueSessionCookie(env.SIGNING_SECRET, account.id),
		},
	});
}
