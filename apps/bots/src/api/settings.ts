// Settings (approvals, 1Password, payments, finance, home routing, Tailscale), channels, billing and recipe import.
import { StripeBilling, TopUpTooSmall } from "../billing/stripe.ts";
import { appOrigin } from "../auth/oauth.ts";
import { createBot } from "./bots.ts";
import { botOf, defined, type Handlers, HttpError, notFound, ownedBot, userOf } from "./http.ts";

const stripeFor = (env: Parameters<typeof userOf>[0]) => {
	if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, "billing_unavailable", "billing is not set up");
	return new StripeBilling({ secretKey: env.STRIPE_SECRET_KEY, apiUrl: env.STRIPE_API_URL, planPrice: env.STRIPE_PLAN_PRICE, topUpProduct: env.STRIPE_TOPUP_PRODUCT });
};

export const settingsHandlers: Handlers = {
	getApprovalSettings: async (env, principal) => userOf(env, principal).approvalSettings(),
	updateApprovalSettings: async (env, principal, patch) => userOf(env, principal).updateApprovalSettings(defined(patch)),
	// 1Password's agent sign-in is not built until its integration is settled (a human task).
	getOnePassword: async () => ({ connected: false }),
	connectOnePassword: async () => {
		throw new HttpError(503, "unavailable", "1Password sign-in is not available yet");
	},
	disconnectOnePassword: async () => ({ ok: true }),
	getPayments: async (env, principal) => userOf(env, principal).payments(),
	linkWallet: async (env, principal) => userOf(env, principal).linkWallet(`${appOrigin(env)}/settings/payments`),
	setSpendLimits: async (env, principal, { limits }) => userOf(env, principal).setSpendLimits(limits),
	getFinance: async (env, principal) => userOf(env, principal).finance(),
	linkBank: async (env, principal) => ({ linkToken: await userOf(env, principal).bankLinkToken() }),
	completeBankLink: async (env, principal, { publicToken }) => {
		const result = await userOf(env, principal).linkBank(publicToken);
		if (result === "insufficient") throw new HttpError(402, "insufficient", "not enough credit for the month's bank-link fee");
		return userOf(env, principal).finance();
	},
	unlinkBank: async (env, principal, { id }) => {
		await userOf(env, principal).unlinkBank(id);
		return { ok: true };
	},
	getHomeRouting: async (env, principal) => userOf(env, principal).homeRouting(),
	updateHomeRouting: async (env, principal, patch) => userOf(env, principal).updateHomeRouting(defined(patch)),
	getTailscale: async (env, principal) => userOf(env, principal).tailscale(),
	joinTailscale: async (env, principal, { authKey, exitNode }) => userOf(env, principal).joinTailscale(authKey, exitNode),
	leaveTailscale: async (env, principal) => userOf(env, principal).leaveTailscale(),

	getChannels: async (env, principal) => userOf(env, principal).channels(),
	createTelegramCode: async (env, principal, { botId }) => userOf(env, principal).telegramCode(await ownedBot(env, principal, botId)),
	slackInstall: async (env) => {
		if (!env.SLACK_CLIENT_ID) throw new HttpError(503, "unavailable", "Slack is not set up");
		const url = new URL("https://slack.com/oauth/v2/authorize");
		url.searchParams.set("client_id", env.SLACK_CLIENT_ID);
		url.searchParams.set("scope", "app_mentions:read,channels:history,chat:write,im:history,im:write,users:read");
		url.searchParams.set("redirect_uri", `${appOrigin(env)}/auth/slack/callback`);
		return { url: url.href };
	},
	linkSlackDms: async (env, principal, { botId }) => userOf(env, principal).linkSlackDms(await ownedBot(env, principal, botId)),
	updateChannelLink: async (env, principal, { id, ...patch }) => {
		if (patch.botId) await ownedBot(env, principal, patch.botId);
		const link = await userOf(env, principal).updateChannelLink(id, defined(patch));
		if (!link) throw notFound(`channel link ${id}`);
		return link;
	},
	deleteChannelLink: async (env, principal, { id }) => {
		await userOf(env, principal).deleteChannelLink(id);
		return { ok: true };
	},

	getBilling: async (env, principal) => userOf(env, principal).billing(),
	subscribe: async (env, principal) => stripeFor(env).checkoutPlan({ accountId: principal.accountId, returnUrl: `${appOrigin(env)}/settings/billing` }),
	cancelSubscription: async (env, principal) => userOf(env, principal).cancelAtPeriodEnd(),
	topUp: async (env, principal, { amount }) => {
		try {
			return await stripeFor(env).checkoutTopUp({ accountId: principal.accountId, amountCents: Math.round(amount * 100), returnUrl: `${appOrigin(env)}/settings/billing` });
		} catch (error) {
			if (error instanceof TopUpTooSmall) throw new HttpError(400, "too_small", error.message);
			throw error;
		}
	},
	setSpendingLimit: async (env, principal, { limit }) => userOf(env, principal).setSpendingLimitDollars(limit),
	setAutoTopUp: async (env, principal, autoTopUp) => userOf(env, principal).setAutoTopUp(autoTopUp),

	importRecipe: async (env, principal, request) => {
		const { recipe } = request;
		const bot = await createBot(env, principal, {
			name: recipe.profile.name,
			...(request.model ? { model: request.model } : {}),
			instructions: recipe.profile.description,
		});
		const unmatchedPlugins = await botOf(env, bot.id).importRecipeParts(principal, request);
		return { bot: { ...bot, ...(await botOf(env, bot.id).entity(principal)) }, unmatchedPlugins };
	},
};
