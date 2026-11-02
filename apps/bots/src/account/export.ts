// Account export (spec section 15): every bot's chat and notes, the account's files and pages, group chats, and each
// bot as a recipe that imports again here or elsewhere.
import type { FileRef } from "@knightcode/bots-protocol";
import type { Principal } from "../auth/session.ts";
import type { Env } from "../env.ts";

export async function exportAccount(env: Env, principal: Principal) {
	const accountId = principal.accountId;
	const botIds = (await env.DB.prepare("SELECT id FROM bots WHERE account_id = ?").bind(accountId).all<{ id: string }>()).results.map((row) => row.id);
	const bots = [];
	for (const botId of botIds) bots.push(await env.BOT.get(env.BOT.idFromName(botId)).exportData(principal));
	// Restated: the RPC stub type loses FileRef.
	const { pages, files } = (await env.USER.get(env.USER.idFromName(accountId)).exportData()) as { pages: unknown[]; files: { ref: FileRef; base64: string }[] };
	const groups = (
		await env.DB.prepare(
			"SELECT g.id AS id, g.name AS name, m.author AS author, m.text AS text, m.at AS at FROM groups g LEFT JOIN group_messages m ON m.group_id = g.id WHERE g.account_id = ? ORDER BY g.id, m.seq",
		)
			.bind(accountId)
			.all<{ id: string; name: string; author: string | null; text: string | null; at: number | null }>()
	).results;
	return {
		exportedAt: new Date().toISOString(),
		chats: bots.map((bot) => ({ botId: bot.id, name: bot.name, messages: bot.chat })),
		groupChats: groups,
		notes: bots.map((bot) => ({ botId: bot.id, notes: bot.notes })),
		recipes: bots.map((bot) => bot.recipe),
		pages,
		files,
	};
}
