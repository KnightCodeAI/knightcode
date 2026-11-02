// The channel contract (spec section 10): link an outside chat to a user's bot, receive its messages into the bot's
// thread, send replies, and later join group conversations. Telegram, Slack and email implement it here; WhatsApp,
// Teams and Discord are later adapters, not new mechanisms.
//
// Chat SDK spike (Task 3.5, step 3): Vercel's Chat SDK ("chat" 4.43.0 and @chat-adapter/*) is fetch-based with remark
// and unified as its dependencies, so it would likely run on Workers. It requires a StateAdapter (Redis, Postgres or
// ioredis) for subscriptions, locking and dedupe, and its own webhook routing and thread model, while our state lives
// in Durable Objects and D1 and our routing goes through links and the bot object. The contract below is implemented
// directly instead, kept close enough in shape that its adapters could sit behind it later.
import type { Env } from "../env.ts";

export type ChannelId = "telegram" | "slack" | "email";

/** A message from outside, as one channel received it. */
export interface InboundMessage {
	channel: ChannelId;
	/** The chat it came from: a Telegram chat id, "team:user" for a Slack DM, an email address. */
	externalChat: string;
	/** Who sent it, in the channel's terms. */
	externalUser: string;
	text: string;
	/** The channel's id for the message, to reply to it. */
	messageId?: string;
	/** Email threading of the message received. */
	references?: string[];
	subject?: string;
}

export interface ChannelLink {
	channel: ChannelId;
	externalChat: string;
	accountId: string;
	botId: string;
	mode: "direct" | "mentions" | "listen";
}

/** A reply or a message to send on a channel. */
export interface ChannelOutbound {
	text: string;
	/** Reply to this message (keeps email threads and Telegram replies together). */
	replyTo?: string;
	references?: string[];
	subject?: string;
}

export type ChannelDelivery = { ok: true; messageId?: string } | { ok: false; error: string; retryable: boolean };

export interface ChannelAdapter {
	id: ChannelId;
	/** The messages a genuine request carries; undefined when it is not genuine. */
	verify(request: Request, env: Env): Promise<InboundMessage[] | undefined>;
	send(env: Env, link: ChannelLink, message: ChannelOutbound): Promise<ChannelDelivery>;
	/** Group conversations (Telegram groups, Slack channels), joined after the user approves the invite. */
	joinGroup?(env: Env, link: ChannelLink): Promise<void>;
}
