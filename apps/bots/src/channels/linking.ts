// Linking a chat to a bot (spec section 10): the user picks a bot in Settings and sends the shown code to the
// KnightCode Bots Telegram bot within ten minutes. Codes are single-use and stored hashed. Slack DMs are linked from
// the Slack app ("Link DMs"); a link routes that chat to one bot of one account.
import { sha256 } from "../auth/util.ts";
import type { ChannelId, ChannelLink } from "./contract.ts";

const CODE_TTL_MS = 10 * 60_000;
/** No 0/O or 1/I: the code is read off a screen and typed. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function issueLinkCode(
	db: D1Database,
	input: { channel: ChannelId; accountId: string; botId: string },
	now = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
	const expiresAt = now + CODE_TTL_MS;
	await db
		.prepare("INSERT INTO link_codes (code_hash, channel, account_id, bot_id, expires_at) VALUES (?, ?, ?, ?, ?)")
		.bind(await sha256(code), input.channel, input.accountId, input.botId, expiresAt)
		.run();
	return { code, expiresAt };
}

/** Links `externalChat` with a code sent from it: once, within ten minutes. Undefined for anything else. */
export async function consumeLinkCode(
	db: D1Database,
	input: { channel: ChannelId; code: string; externalChat: string },
	now = Date.now(),
): Promise<ChannelLink | undefined> {
	const code = input.code.trim().toUpperCase();
	if (!/^[A-Z2-9]{8}$/.test(code)) return undefined;
	const row = await db
		.prepare("DELETE FROM link_codes WHERE code_hash = ? AND channel = ? AND expires_at > ? RETURNING account_id, bot_id")
		.bind(await sha256(code), input.channel, now)
		.first<{ account_id: string; bot_id: string }>();
	if (!row) return undefined;
	return setLink(db, { channel: input.channel, externalChat: input.externalChat, accountId: row.account_id, botId: row.bot_id, mode: "direct" });
}

export async function setLink(db: D1Database, link: ChannelLink): Promise<ChannelLink> {
	await db
		.prepare(
			"INSERT INTO channel_links (channel, external_chat, account_id, bot_id, mode, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
				"ON CONFLICT (channel, external_chat) DO UPDATE SET account_id = excluded.account_id, bot_id = excluded.bot_id, mode = excluded.mode",
		)
		.bind(link.channel, link.externalChat, link.accountId, link.botId, link.mode, Date.now())
		.run();
	return link;
}

export async function linkFor(db: D1Database, channel: ChannelId, externalChat: string): Promise<ChannelLink | undefined> {
	const row = await db
		.prepare("SELECT account_id, bot_id, mode FROM channel_links WHERE channel = ? AND external_chat = ?")
		.bind(channel, externalChat)
		.first<{ account_id: string; bot_id: string; mode: ChannelLink["mode"] }>();
	return row ? { channel, externalChat, accountId: row.account_id, botId: row.bot_id, mode: row.mode } : undefined;
}
