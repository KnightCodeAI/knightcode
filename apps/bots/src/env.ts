import type { BotObject, ComputerObject, UserObject } from "./worker.ts";

/** A queued delivery: the bot whose action record holds the write. */
export interface OutboundMessage {
	botId: string;
	actionId: string;
}

export interface Env {
	DB: D1Database;
	FILES: R2Bucket;
	BOT: DurableObjectNamespace<BotObject>;
	USER: DurableObjectNamespace<UserObject>;
	COMPUTER: DurableObjectNamespace<ComputerObject>;
	OUTBOUND: Queue<OutboundMessage>;
	ASSETS: Fetcher;
	SESSION_SECRET: string;
	/** Secrets Store binding holding the base64 key-encryption key. */
	KEK: SecretsStoreSecret;
	/** Tests supply the key as a plain binding because the pool does not emulate Secrets Store. */
	TEST_KEK?: string;
	/** "fake" in the Workers test pool, which runs no containers; the computer is a Cloudflare container otherwise. */
	BOTS_COMPUTER_PROVIDER?: string;
	/** This site's origin; https://bots.knightcode.dev unless set (local development). */
	APP_ORIGIN?: string;
	/** OAuth apps for sign-in (secrets). */
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	/** Tests only: the emulated services' base URLs, which replace the providers' own hosts. */
	EMULATE_GITHUB_URL?: string;
	EMULATE_GOOGLE_URL?: string;
	/** The GitHub App (spec section 12): webhook secret, app id and private key (PKCS#8 PEM), all secrets. */
	GITHUB_APP_WEBHOOK_SECRET?: string;
	GITHUB_APP_ID?: string;
	GITHUB_APP_PRIVATE_KEY?: string;
	/** The Slack app's signing secret. */
	SLACK_SIGNING_SECRET?: string;
	/** Composio's webhook signing secret. */
	COMPOSIO_WEBHOOK_SECRET?: string;
	/** Stripe (agent payments): secret key, and (tests) the emulator's base URL. Payments are offered in PAYMENTS_COUNTRIES. */
	STRIPE_SECRET_KEY?: string;
	STRIPE_API_URL?: string;
	/** Slack's OAuth client id, for installing the app into a workspace. */
	SLACK_CLIENT_ID?: string;
	/** Development and browser tests only, never in a deployed configuration: "1" serves the seed import. */
	BOTS_DEV_SEED?: string;
	/** Development only: an OpenAI-compatible server (the fake model server) offered as the provider "fake". */
	BOTS_DEV_MODEL_URL?: string;
	/** Web Push (VAPID): the public key (raw P-256, base64url), its private scalar (a secret, base64url) and contact. */
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	/** Signs Stripe's webhooks (a secret). */
	STRIPE_WEBHOOK_SECRET?: string;
	/** The plan's monthly price and the top-up product, created once in Stripe. */
	STRIPE_PLAN_PRICE?: string;
	STRIPE_TOPUP_PRODUCT?: string;
	PAYMENTS_COUNTRIES?: string;
	/** Plaid (bank data): client id and secret, and (tests) the emulator's base URL. */
	PLAID_CLIENT_ID?: string;
	PLAID_SECRET?: string;
	PLAID_API_URL?: string;
	/** "on" once 1Password's agent sign-in route is built (a human task settles it first). */
	ONEPASSWORD_AGENT_SIGNIN?: string;
	/** Composio's API key (a secret) and, in tests, the emulator's base URL. */
	COMPOSIO_API_KEY?: string;
	COMPOSIO_BASE_URL?: string;
	/** Tests only: the emulated remote MCP server. */
	EMULATE_MCP_URL?: string;
	/** Outbound mail (Email Service). */
	EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; headers?: Record<string, string> }): Promise<unknown> };
	/** The KnightCode Bots Telegram bot: its token, the webhook's secret token, and (tests) the emulated Bot API. */
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_WEBHOOK_SECRET?: string;
	TELEGRAM_API_URL?: string;
	/** Tests only: the emulated Slack Web API. */
	SLACK_API_URL?: string;
}

/** The AES-KW key-encryption key (256-bit, base64 secret) used to wrap per-record data keys. */
export async function getKek(env: Env): Promise<CryptoKey> {
	const base64 = env.TEST_KEK ?? (await env.KEK.get());
	const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey("raw", raw, "AES-KW", false, ["wrapKey", "unwrapKey"]);
}
