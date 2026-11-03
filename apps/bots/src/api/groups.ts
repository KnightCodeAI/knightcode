// Group chats: the group in D1 (members, lead, rules, turn budget), its sidebar flags with the account, and its
// thread from the group's messages.
import type { ConversationView, Group } from "@knightcode/bots-protocol";
import { groupEntries, pageOf } from "../team/group-view.ts";
import type { Principal } from "../auth/session.ts";
import type { Env } from "../env.ts";
import { MAX_MEMBERS, MIN_MEMBERS } from "../team/groups.ts";
import { defined, type Handlers, HttpError, notFound, ownedBot, userOf } from "./http.ts";

type Row = { id: string; name: string; lead_bot: string; members: string; turn_budget: number; created_at: number };

async function groupRow(env: Env, principal: Principal, groupId: string): Promise<Row> {
	const row = await env.DB.prepare("SELECT id, name, lead_bot, members, turn_budget, created_at FROM groups WHERE id = ? AND account_id = ?")
		.bind(groupId, principal.accountId)
		.first<Row>();
	if (!row) throw notFound(`group ${groupId}`);
	return row;
}

function toGroup(row: Row, flags: { pinned?: boolean; unread?: number; needsYou?: boolean } = {}): Group {
	return {
		id: row.id,
		name: row.name,
		memberIds: JSON.parse(row.members) as string[],
		leadId: row.lead_bot,
		turnBudget: row.turn_budget,
		pinned: flags.pinned ?? false,
		unread: flags.unread ?? 0,
		needsYou: flags.needsYou ?? false,
		createdAt: row.created_at,
	};
}

export async function listGroups(env: Env, principal: Principal): Promise<Group[]> {
	const sidebar = await userOf(env, principal).sidebar();
	const rows = await env.DB.prepare("SELECT id, name, lead_bot, members, turn_budget, created_at FROM groups WHERE account_id = ? ORDER BY created_at")
		.bind(principal.accountId)
		.all<Row>();
	return rows.results.map((row) => toGroup(row, sidebar.groups[row.id]));
}

export async function groupEntity(env: Env, principal: Principal, groupId: string): Promise<Group> {
	const row = await groupRow(env, principal, groupId);
	return toGroup(row, (await userOf(env, principal).sidebar()).groups[groupId]);
}

/** The group's thread: its messages, the user's as user rows and each bot's as that bot's. */
export async function groupView(env: Env, principal: Principal, groupId: string, before?: string, limit = 50): Promise<ConversationView> {
	await groupRow(env, principal, groupId);
	const entries = await groupEntries(env.DB, groupId, await userOf(env, principal).reactions(`group:${groupId}`));
	return pageOf(entries, false, before, limit);
}

async function changed(env: Env, principal: Principal, groupId: string): Promise<Group> {
	const group = await groupEntity(env, principal, groupId);
	await userOf(env, principal).broadcast({ kind: "group", group });
	return group;
}

export const groupHandlers: Handlers = {
	createGroup: async (env, principal, { name, memberIds, leadId }) => {
		if (memberIds.length < MIN_MEMBERS || memberIds.length > MAX_MEMBERS) throw new HttpError(400, "invalid", `a group has ${MIN_MEMBERS} to ${MAX_MEMBERS} bots`);
		for (const id of memberIds) await ownedBot(env, principal, id);
		if (!memberIds.includes(leadId)) throw new HttpError(400, "invalid", "the lead must be a member");
		const base =
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") || "group";
		const id = `${base}-${crypto.randomUUID().slice(0, 6)}`;
		await env.DB.prepare("INSERT INTO groups (id, account_id, name, lead_bot, members, turn_budget, created_at) VALUES (?, ?, ?, ?, ?, 12, ?)")
			.bind(id, principal.accountId, name, leadId, JSON.stringify(memberIds), Date.now())
			.run();
		return changed(env, principal, id);
	},
	getGroup: async (env, principal, { groupId }) => groupEntity(env, principal, groupId),
	updateGroup: async (env, principal, { groupId, ...patch }) => {
		const row = await groupRow(env, principal, groupId);
		const fields = defined(patch) as Partial<Group>;
		const members = fields.memberIds ?? (JSON.parse(row.members) as string[]);
		const lead = fields.leadId ?? row.lead_bot;
		for (const id of fields.memberIds ?? []) await ownedBot(env, principal, id);
		if (!members.includes(lead)) throw new HttpError(400, "invalid", "the lead must be a member");
		await env.DB.prepare("UPDATE groups SET name = ?, lead_bot = ?, members = ?, turn_budget = ? WHERE id = ? AND account_id = ?")
			.bind(fields.name ?? row.name, lead, JSON.stringify(members), fields.turnBudget ?? row.turn_budget, groupId, principal.accountId)
			.run();
		const flags = defined({ pinned: fields.pinned, unread: fields.unread, needsYou: fields.needsYou });
		if (Object.keys(flags).length > 0) await userOf(env, principal).setGroupFlags(groupId, flags);
		return changed(env, principal, groupId);
	},
	deleteGroup: async (env, principal, { groupId }) => {
		await groupRow(env, principal, groupId);
		await env.DB.batch([
			env.DB.prepare("DELETE FROM group_messages WHERE group_id = ?").bind(groupId),
			env.DB.prepare("DELETE FROM group_turns WHERE group_id = ?").bind(groupId),
			env.DB.prepare("DELETE FROM groups WHERE id = ? AND account_id = ?").bind(groupId, principal.accountId),
		]);
		return { ok: true };
	},
	getGroupHistory: async (env, principal, { groupId, before, limit }) => groupView(env, principal, groupId, before, limit),
	reactInGroup: async (env, principal, { groupId, entryId, emoji }) => {
		const view = await groupView(env, principal, groupId, undefined, Number.MAX_SAFE_INTEGER);
		if (!view.entries.some((entry) => entry.id === entryId)) throw notFound(`message ${entryId}`);
		await userOf(env, principal).react(`group:${groupId}`, entryId, emoji);
		return { ok: true };
	},
};
