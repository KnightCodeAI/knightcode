// Telegram (spec section 10): one KnightCode Bots Telegram bot for everyone. Its webhook carries the secret token set
// when the webhook was registered; a chat is linked to a user's bot with a code from Settings, then its messages reach
// that bot's thread and the bot's replies go back to it.
import type { Env } from "../env.ts";
import type { ChannelAdapter, ChannelDelivery, ChannelLink, ChannelOutbound, InboundMessage } from "./contract.ts";

const LIMIT = 4_096;

type Update = { message?: { message_id: number; chat: { id: number; type: string }; from?: { id: number }; text?: string } };

const api = (env: Env, method: string) => `${env.TELEGRAM_API_URL ?? "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

/** Splits text into Telegram-sized messages, at line breaks where it can. */
export function chunks(text: string, limit = LIMIT): string[] {
	const out: string[] = [];
	let rest = text;
	while (rest.length > limit) {
		const cut = rest.lastIndexOf("\n", limit) > limit / 2 ? rest.lastIndexOf("\n", limit) : limit;
		out.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^\n/, "");
	}
	return [...out, rest];
}

export const telegramChannel: ChannelAdapter = {
	id: "telegram",
	async verify(request, env) {
		if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) return undefined;
		const update = (await request.json().catch(() => ({}))) as Update;
		const message = update.message;
		if (!message?.text || !message.from) return [];
		const inbound: InboundMessage = {
			channel: "telegram",
			externalChat: String(message.chat.id),
			externalUser: String(message.from.id),
			text: message.text,
			messageId: String(message.message_id),
		};
		return [inbound];
	},
	async send(env: Env, link: ChannelLink, message: ChannelOutbound): Promise<ChannelDelivery> {
		if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: "Telegram is not set up", retryable: false };
		let first: string | undefined;
		for (const [index, text] of chunks(message.text).entries()) {
			const response = await fetch(api(env, "sendMessage"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					chat_id: link.externalChat,
					text,
					...(index === 0 && message.replyTo ? { reply_parameters: { message_id: Number(message.replyTo), allow_sending_without_reply: true } } : {}),
				}),
			});
			if (!response.ok) return { ok: false, error: `Telegram answered ${response.status}`, retryable: response.status >= 500 || response.status === 429 };
			first ??= String(((await response.json()) as { result?: { message_id?: number } }).result?.message_id ?? "");
		}
		return { ok: true, ...(first ? { messageId: first } : {}) };
	},
};

/** Tells a chat something outside a bot's thread (link confirmations, "send your code"). */
export async function telegramNotice(env: Env, chatId: string, text: string): Promise<void> {
	if (!env.TELEGRAM_BOT_TOKEN) return;
	await fetch(api(env, "sendMessage"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text }),
	});
}
