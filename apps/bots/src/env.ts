import type { BotObject, ComputerObject, UserObject } from "./worker.ts";

/** A message queued for delivery through a channel. Filled in by the channel tasks. */
export interface OutboundMessage {
	channel: string;
	to: string;
	text: string;
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
}

/** The AES-KW key-encryption key (256-bit, base64 secret) used to wrap per-record data keys. */
export async function getKek(env: Env): Promise<CryptoKey> {
	const base64 = env.TEST_KEK ?? (await env.KEK.get());
	const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey("raw", raw, "AES-KW", false, ["wrapKey", "unwrapKey"]);
}
