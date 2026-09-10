/**
 * Account routes.
 *
 * The IDE learns what it can sign in to, what is signed in, and how to sign
 * out, from here. Responses carry credential *metadata* only: no key, token, or
 * refresh token may appear in a body this module sends.
 */

import type { EngineContext } from "./context.ts";
import { type EngineRoute, sendJson } from "./server.ts";

export interface AccountSummary {
	providerId: string;
	providerName: string;
	type: "api_key" | "oauth";
	isSubscription: boolean;
}

export interface LoginOption {
	providerId: string;
	providerName: string;
	type: "api_key" | "oauth";
	label: string;
	isSubscription: boolean;
}

function loginOptions(ctx: EngineContext): LoginOption[] {
	const options: LoginOption[] = [];
	for (const provider of ctx.models.getProviders()) {
		const oauth = provider.auth.oauth;
		if (oauth) {
			options.push({
				providerId: provider.id,
				providerName: provider.name,
				type: "oauth",
				label: oauth.loginLabel ?? oauth.name,
				isSubscription: oauth.isSubscription === true,
			});
		}
		// A provider without `login` is ambient-only: it resolves from an env
		// var or a credentials file and there is nothing for the IDE to prompt.
		const apiKey = provider.auth.apiKey;
		if (apiKey?.login) {
			options.push({
				providerId: provider.id,
				providerName: provider.name,
				type: "api_key",
				label: apiKey.name,
				isSubscription: false,
			});
		}
	}
	return options;
}

export function accountsRoutes(ctx: EngineContext): readonly EngineRoute[] {
	return [
		{
			method: "GET",
			path: "/v1/accounts",
			handle: async (_req, res) => {
				const stored = await ctx.credentials.list();
				const accounts: AccountSummary[] = stored.map((entry) => {
					const provider = ctx.models.getProvider(entry.providerId);
					return {
						providerId: entry.providerId,
						providerName: provider?.name ?? entry.providerId,
						type: entry.type,
						isSubscription: entry.type === "oauth" && provider?.auth.oauth?.isSubscription === true,
					};
				});
				sendJson(res, 200, { accounts, loginOptions: loginOptions(ctx) });
			},
		},
		{
			method: "DELETE",
			path: "/v1/accounts",
			prefix: true,
			handle: async (_req, res, url) => {
				const providerId = decodeURIComponent(url.pathname.slice("/v1/accounts/".length));
				if (!ctx.models.getProvider(providerId)) {
					sendJson(res, 404, { error: "unknown_provider" });
					return;
				}
				await ctx.models.logout(providerId);
				ctx.events.publish({ type: "account.changed", providerId, authenticated: false });
				res.writeHead(204);
				res.end();
			},
		},
	];
}
