// Development and browser tests only: loads a FakeSeed (the world the UI was built against) into a fresh account of
// the real backend, through the same stores real use writes: bots, their threads' history and cards, notes, routines,
// groups, pages, skills, the inbox, settings and billing. Served only when BOTS_DEV_SEED is "1", which no deployed
// configuration sets.
import type { FakeSeed } from "@knightcode/bots-protocol";
import type { Principal } from "../auth/session.ts";
import { claimBotAddress } from "../channels/addresses.ts";
import type { Env } from "../env.ts";
import { botOf, HttpError, userOf } from "../api/http.ts";

export const devSeedEnabled = (env: Env) => env.BOTS_DEV_SEED === "1";

export async function importSeed(env: Env, principal: Principal, seed: FakeSeed): Promise<{ bots: number }> {
	if (!devSeedEnabled(env)) throw new HttpError(404, "not_found");
	const user = userOf(env, principal);
	// A seeded world is past sign-up: its handle, or a made-up one when the seed has none.
	const handle = seed.account.handle ?? `seed-${crypto.randomUUID().slice(0, 8)}`;
	await env.DB.prepare("INSERT OR IGNORE INTO handles (handle, account_id, created_at) VALUES (?, ?, ?)").bind(handle, principal.accountId, Date.now()).run();
	await user.importSeed(seed);
	for (const bot of seed.bots) {
		await botOf(env, bot.id).importSeed(principal, {
			bot,
			thread: seed.threads[`bot:${bot.id}`],
			notes: seed.notes[bot.id] ?? [],
			openWork: seed.openWork[bot.id] ?? [],
			routines: seed.routines.filter((routine) => routine.botId === bot.id),
			approvals: seed.approvals.filter((approval) => approval.botId === bot.id),
			instructionVersions: seed.instructionVersions[bot.id] ?? [],
			reply: seed.replies[bot.id],
		});
		if (bot.email) await claimBotAddress(env.DB, { address: bot.email, botId: bot.id, accountId: principal.accountId }).catch(() => undefined);
	}
	for (const [manager, managed] of Object.entries(seed.managed))
		for (const id of managed) await env.DB.prepare("UPDATE bots SET managed_by = ? WHERE id = ? AND account_id = ?").bind(manager, id, principal.accountId).run();
	for (const group of seed.groups) {
		await env.DB.prepare("INSERT OR REPLACE INTO groups (id, account_id, name, lead_bot, members, turn_budget, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.bind(group.id, principal.accountId, group.name, group.leadId, JSON.stringify(group.memberIds), group.turnBudget, group.createdAt)
			.run();
		const thread = seed.threads[`group:${group.id}`];
		let seq = 0;
		for (const entry of thread?.entries ?? []) {
			if (entry.kind !== "message") continue;
			await env.DB.prepare("INSERT INTO group_messages (group_id, seq, author, text, at) VALUES (?, ?, ?, ?, ?)")
				.bind(group.id, ++seq, entry.role === "user" ? "user" : (entry.botId ?? group.leadId), entry.text, entry.createdAt)
				.run();
		}
	}
	return { bots: seed.bots.length };
}
