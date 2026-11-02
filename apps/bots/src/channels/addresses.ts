// Bot email addresses (spec section 10): `<bot>.<handle>@bots.knightcode.dev`. The bot part comes from the bot's name;
// a clash between one user's bots is the user's to resolve (no number suffixes, ever). A renamed bot keeps its old
// address delivering, and no address is ever reassigned. Reserved words and brand lookalikes are refused.

export const MAIL_DOMAIN = "bots.knightcode.dev";

const RESERVED = new Set([
	"admin", "administrator", "root", "support", "help", "billing", "security", "postmaster", "hostmaster", "webmaster",
	"abuse", "noreply", "no-reply", "mailer-daemon", "bounce", "bounces", "info", "sales", "legal", "privacy", "team",
	"staff", "official", "system", "notifications", "verify", "account", "accounts", "payments", "dmarc",
]);
/** Brands a bot address must not pose as. */
const BRANDS = ["knightcode", "anthropic", "openai", "google", "gmail", "microsoft", "apple", "paypal", "stripe", "github", "slack", "telegram"];

export class AddressRefused extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "AddressRefused";
	}
}

/** The bot part from a bot's name: lowercase letters, digits and hyphens. */
export const botPart = (name: string) =>
	name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30);

/** `<bot>.<handle>@bots.knightcode.dev` for a bot's name and the user's handle. */
export const botAddress = (botName: string, handle: string) => `${botPart(botName)}.${handle.toLowerCase()}@${MAIL_DOMAIN}`;

/** Why `local` (the part before @) is refused, or undefined when it may be used. */
export function refusal(local: string): string | undefined {
	const [bot, handle, extra] = local.split(".");
	if (!bot || !handle || extra !== undefined) return "An address is <bot>.<handle>.";
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bot)) return "Use letters, digits and hyphens for the bot part.";
	if (RESERVED.has(bot) || RESERVED.has(handle)) return `"${RESERVED.has(bot) ? bot : handle}" is reserved.`;
	// Look-alike digits read as the letters they stand for (knightc0de), then separators go.
	const LOOKS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t" };
	const squashed = bot.replace(/[013457]/g, (digit) => LOOKS[digit]!).replace(/[-0-9]/g, "");
	if (BRANDS.some((brand) => squashed.includes(brand))) return "That looks like another brand's name.";
	return undefined;
}

/**
 * Claims `address` for a bot. Refused when reserved, a lookalike, or taken by anyone (including the user's own other
 * bot, and any address ever used: addresses are never reassigned). The bot keeps its earlier addresses delivering.
 */
export async function claimBotAddress(db: D1Database, input: { address: string; botId: string; accountId: string }): Promise<string> {
	const address = input.address.trim().toLowerCase();
	const [local, domain] = address.split("@");
	if (domain !== MAIL_DOMAIN || !local) throw new AddressRefused(`Addresses end in @${MAIL_DOMAIN}.`);
	const reason = refusal(local);
	if (reason) throw new AddressRefused(reason);
	const inserted = await db
		.prepare("INSERT OR IGNORE INTO bot_addresses (address, bot_id, account_id) VALUES (?, ?, ?)")
		.bind(address, input.botId, input.accountId)
		.run();
	if (inserted.meta.changes !== 1) {
		const owner = await db.prepare("SELECT bot_id FROM bot_addresses WHERE address = ?").bind(address).first<{ bot_id: string }>();
		// Claiming an address the bot already has is fine; anyone else's, or a retired one, is not.
		if (owner?.bot_id !== input.botId) throw new AddressRefused("That address is taken. Pick another name for this bot's address.");
	}
	return address;
}
