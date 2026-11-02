// Email (spec section 10): each bot sends from its own address. Replies keep Message-ID, In-Reply-To and References so
// threads stay together. The domain's reputation is shared, so mail to people who have not written to the user's bots
// first is capped at 50 recipients a day per user, and a bounce or complaint rate above the threshold pauses that
// user's outbound mail. Replies to correspondents are not capped.
import type { WriteAdapter } from "../bot/actions.ts";
import type { Env } from "../env.ts";
import { MAIL_DOMAIN } from "./addresses.ts";
import type { ChannelAdapter, ChannelDelivery, ChannelLink, ChannelOutbound } from "./contract.ts";

export const NEW_RECIPIENTS_PER_DAY = 50;
/** Bounces and complaints above this share of mail sent (after enough mail to judge) pause sending for a day. */
export const BOUNCE_RATE = 0.05;
const BOUNCE_MIN_SENT = 20;
const PAUSE_MS = 24 * 60 * 60_000;

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Someone wrote to one of the account's bots: replies to them are never capped. */
export async function recordCorrespondent(db: D1Database, accountId: string, address: string): Promise<void> {
	await db.prepare("INSERT OR IGNORE INTO email_correspondents (account_id, address) VALUES (?, ?)").bind(accountId, address.toLowerCase()).run();
}

export async function recordBounce(db: D1Database, accountId: string, now = Date.now()): Promise<void> {
	const row = await db
		.prepare(
			"INSERT INTO email_health (account_id, bounces, sent) VALUES (?, 1, 0) ON CONFLICT (account_id) DO UPDATE SET bounces = bounces + 1 RETURNING bounces, sent",
		)
		.bind(accountId)
		.first<{ bounces: number; sent: number }>();
	if (row && row.sent >= BOUNCE_MIN_SENT && row.bounces / row.sent > BOUNCE_RATE)
		await db.prepare("UPDATE email_health SET paused_until = ? WHERE account_id = ?").bind(now + PAUSE_MS, accountId).run();
}

/** Whether mail to `recipient` may go now; records it when it may. */
export async function admitSend(db: D1Database, accountId: string, recipient: string, now = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
	const address = recipient.toLowerCase();
	const health = await db.prepare("SELECT paused_until FROM email_health WHERE account_id = ?").bind(accountId).first<{ paused_until: number | null }>();
	if (health?.paused_until && health.paused_until > now) return { ok: false, error: "Outbound mail is paused after too many bounces; it resumes within a day." };
	const known = await db.prepare("SELECT 1 AS known FROM email_correspondents WHERE account_id = ? AND address = ?").bind(accountId, address).first();
	const today = day(now);
	if (!known) {
		const already = await db
			.prepare("SELECT 1 AS sent FROM email_sends WHERE account_id = ? AND recipient = ? AND day = ? AND is_new = 1")
			.bind(accountId, address, today)
			.first();
		if (!already) {
			const count = await db
				.prepare("SELECT COUNT(DISTINCT recipient) AS n FROM email_sends WHERE account_id = ? AND day = ? AND is_new = 1")
				.bind(accountId, today)
				.first<{ n: number }>();
			if ((count?.n ?? 0) >= NEW_RECIPIENTS_PER_DAY)
				return { ok: false, error: `Mail to people who have not written first is limited to ${NEW_RECIPIENTS_PER_DAY} a day.` };
		}
	}
	await db.batch([
		db.prepare("INSERT INTO email_sends (account_id, recipient, day, is_new, at) VALUES (?, ?, ?, ?, ?)").bind(accountId, address, today, known ? 0 : 1, now),
		db
			.prepare("INSERT INTO email_health (account_id, bounces, sent) VALUES (?, 0, 1) ON CONFLICT (account_id) DO UPDATE SET sent = sent + 1")
			.bind(accountId),
	]);
	return { ok: true };
}

/** A new Message-ID on our domain. */
export const messageId = () => `<${crypto.randomUUID()}@${MAIL_DOMAIN}>`;

/** Threading headers for a reply: In-Reply-To the message, References its chain plus the message. */
export function threadHeaders(replyTo: string | undefined, references: string[] = []): Record<string, string> {
	if (!replyTo) return {};
	const chain = [...references.filter((ref) => ref !== replyTo), replyTo].slice(-20);
	return { "In-Reply-To": replyTo, References: chain.join(" ") };
}

export async function sendMail(
	env: Env,
	input: { accountId: string; from: string; to: string; subject: string; text: string; replyTo?: string; references?: string[] },
): Promise<ChannelDelivery> {
	if (!env.EMAIL) return { ok: false, error: "email sending is not set up", retryable: false };
	const admitted = await admitSend(env.DB, input.accountId, input.to);
	if (!admitted.ok) return { ok: false, error: admitted.error, retryable: false };
	const id = messageId();
	await env.EMAIL.send({
		to: input.to,
		from: input.from,
		subject: input.subject,
		text: input.text,
		headers: { "Message-ID": id, ...threadHeaders(input.replyTo, input.references) },
	});
	return { ok: true, messageId: id };
}

export const emailChannel: ChannelAdapter = {
	id: "email",
	// Mail arrives through the Worker's email handler, not over HTTP.
	async verify() {
		return undefined;
	},
	async send(env: Env, link: ChannelLink, message: ChannelOutbound): Promise<ChannelDelivery> {
		const from = await env.DB.prepare("SELECT address FROM bot_addresses WHERE bot_id = ? ORDER BY rowid DESC LIMIT 1")
			.bind(link.botId)
			.first<{ address: string }>();
		if (!from) return { ok: false, error: "the bot has no email address", retryable: false };
		// A reply's subject is "Re: …" of the mail it answers; a new mail keeps its own.
		const subject = message.replyTo && message.subject && !/^re:/i.test(message.subject) ? `Re: ${message.subject}` : (message.subject ?? "Message from your bot");
		return sendMail(env, {
			accountId: link.accountId,
			from: from.address,
			to: link.externalChat,
			subject,
			text: message.text,
			...(message.replyTo ? { replyTo: message.replyTo } : {}),
			...(message.references ? { references: message.references } : {}),
		});
	},
};

/** send_email's delivery: a "neither" adapter (a sent mail cannot be checked or deduplicated, so it is never resent). */
export function emailWriteAdapter(env: Env, bot: { accountId: string; botId: string }): WriteAdapter {
	return {
		id: "email.send",
		kind: "neither",
		send: async (action) => {
			const args = action.intent.args as { to: string; subject: string; body: string };
			const link: ChannelLink = { channel: "email", externalChat: args.to, accountId: bot.accountId, botId: bot.botId, mode: "direct" };
			const result = await emailChannel.send(env, link, { text: args.body, subject: args.subject });
			return result.ok ? { ok: true } : { ok: false, error: result.error };
		},
	};
}
