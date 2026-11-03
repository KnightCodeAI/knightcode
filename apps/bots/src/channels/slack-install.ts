// "Add to Slack" (spec section 10): the app is installed in a workspace through Slack's OAuth. The state names the
// account and is signed, so a callback can only finish an install the same account started; the workspace is recorded
// for the account (routing its events and DMs) and the app's bot token is kept with the account's credentials.
import { appOrigin } from "../auth/oauth.ts";
import { hmac, hmacVerify, randomToken } from "../auth/util.ts";
import type { Env } from "../env.ts";

const SCOPES = "app_mentions:read,channels:history,chat:write,im:history,im:write,users:read";
const STATE_TTL_MS = 10 * 60_000;
const callbackUrl = (env: Env) => `${appOrigin(env)}/auth/slack/callback`;

export async function slackInstallUrl(env: Env, accountId: string): Promise<string> {
	if (!env.SLACK_CLIENT_ID) throw new Error("Slack is not set up");
	const payload = `${accountId}.${Date.now() + STATE_TTL_MS}.${randomToken(12)}`;
	const url = new URL(`${env.SLACK_OAUTH_URL ?? "https://slack.com"}/oauth/v2/authorize`);
	url.searchParams.set("client_id", env.SLACK_CLIENT_ID);
	url.searchParams.set("scope", SCOPES);
	url.searchParams.set("redirect_uri", callbackUrl(env));
	url.searchParams.set("state", `${payload}.${await hmac(env.SESSION_SECRET, `slack:${payload}`)}`);
	return url.href;
}

/** Slack's redirect back: checks the signed state, trades the code, records the workspace. */
export async function completeSlackInstall(env: Env, request: Request): Promise<Response> {
	const url = new URL(request.url);
	const done = (outcome: string) => Response.redirect(new URL(`/settings/channels?slack=${outcome}`, appOrigin(env)).href, 302);
	const state = url.searchParams.get("state") ?? "";
	const code = url.searchParams.get("code");
	const parts = state.split(".");
	if (parts.length !== 4 || !code) return done("failed");
	const [accountId, expires, nonce, signature] = parts as [string, string, string, string];
	if (!(await hmacVerify(env.SESSION_SECRET, `slack:${accountId}.${expires}.${nonce}`, signature)) || Number(expires) < Date.now()) return done("expired");
	const response = await fetch(`${env.SLACK_API_URL ?? "https://slack.com/api"}/oauth.v2.access`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: env.SLACK_CLIENT_ID ?? "", client_secret: env.SLACK_CLIENT_SECRET ?? "", code, redirect_uri: callbackUrl(env) }),
	});
	const body = (await response.json().catch(() => ({}))) as { ok?: boolean; access_token?: string; team?: { id?: string }; authed_user?: { id?: string } };
	if (!body.ok || !body.access_token || !body.team?.id) return done("failed");
	await env.DB.prepare("INSERT OR REPLACE INTO slack_teams (team_id, account_id, owner_user_id) VALUES (?, ?, ?)")
		.bind(body.team.id, accountId, body.authed_user?.id ?? null)
		.run();
	const token = body.access_token;
	await env.USER.get(env.USER.idFromName(accountId)).credentialModify(`slack:${body.team.id}`, async () => ({ type: "api_key", key: token }));
	return done("installed");
}
