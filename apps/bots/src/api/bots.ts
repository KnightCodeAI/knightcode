// Bots and the sidebar: a protocol Bot is the bot object's own settings and status, the account's sidebar flags (pin,
// archive, section, unread, needs-you) and the bot's email address.
import { type Bot, checkName, type RouteResponse } from "@knightcode/bots-protocol";
import { TEMPLATES } from "@knightcode/bots-ui/templates";
import type { Principal } from "../auth/session.ts";
import { AddressRefused, claimBotAddress, MAIL_DOMAIN } from "../channels/addresses.ts";
import type { Env } from "../env.ts";
import { exportRecipe } from "../recipes/recipes.ts";
import { listGroups } from "./groups.ts";
import { botOf, defined, type Handlers, HttpError, notFound, ownedBot, userOf } from "./http.ts";

type Sidebar = Awaited<ReturnType<ReturnType<typeof userOf>["sidebar"]>>;

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "bot";

/** One bot as the client sees it. */
export async function botEntity(env: Env, principal: Principal, botId: string, sidebar?: Sidebar): Promise<Bot> {
	const core = await botOf(env, botId).entity(principal);
	const flags = (sidebar ?? (await userOf(env, principal).sidebar())).bots[botId] ?? {};
	const email = await env.DB.prepare("SELECT address FROM bot_addresses WHERE bot_id = ? AND account_id = ?")
		.bind(botId, principal.accountId)
		.first<{ address: string }>();
	return {
		...core,
		pinned: flags.pinned ?? false,
		archived: flags.archived ?? false,
		unread: flags.unread ?? 0,
		needsYou: flags.needsYou ?? false,
		...(flags.sectionId ? { sectionId: flags.sectionId } : {}),
		...(flags.main ? { main: true } : {}),
		...(email ? { email: email.address } : {}),
	};
}

export async function accountBotIds(env: Env, principal: Principal): Promise<string[]> {
	const rows = await env.DB.prepare("SELECT id FROM bots WHERE account_id = ? ORDER BY sort_order, created_at").bind(principal.accountId).all<{ id: string }>();
	return rows.results.map((row) => row.id);
}

async function changed(env: Env, principal: Principal, botId: string): Promise<Bot> {
	const bot = await botEntity(env, principal, botId);
	await userOf(env, principal).broadcast({ kind: "bot", bot });
	return bot;
}

/** Creates a bot: a fresh id from its name, claimed by the account, with its first settings. */
async function createBot(env: Env, principal: Principal, fields: Partial<Bot> & { name: string; model?: Bot["model"] }, id?: string): Promise<Bot> {
	const account = await userOf(env, principal).account();
	const model = fields.model ?? account.defaultModel;
	if (!model) throw new HttpError(400, "model_required", "choose a model for this bot");
	const botId = id ?? `${slug(fields.name)}-${crypto.randomUUID().slice(0, 6)}`;
	const bot = botOf(env, botId);
	await bot.create(principal, { ...defined(fields), name: fields.name, model });
	const user = userOf(env, principal);
	const sidebar = await user.sidebar();
	// The account's first bot is its main bot.
	if (!Object.values(sidebar.bots).some((flags) => flags.main)) await user.setBotFlags(botId, { main: true });
	// The address comes from the name when it is valid and free; otherwise the user picks one later.
	const local = slug(fields.name);
	if (checkName(local) === "ok" && account.handle)
		await claimBotAddress(env.DB, { address: `${local}.${account.handle}@${MAIL_DOMAIN}`, botId, accountId: principal.accountId }).catch(() => undefined);
	return changed(env, principal, botId);
}

export const botHandlers: Handlers = {
	listBots: async (env, principal, { archived }) => {
		const sidebar = await userOf(env, principal).sidebar();
		const bots = await Promise.all((await accountBotIds(env, principal)).map((id) => botEntity(env, principal, id, sidebar)));
		return {
			bots: bots.filter((bot) => bot.archived === (archived ?? false)),
			groups: await listGroups(env, principal),
			sections: sidebar.sections,
		};
	},
	createBot: async (env, principal, { templateId, ...fields }) => {
		const template = templateId ? TEMPLATES.find((candidate) => candidate.id === templateId) : undefined;
		if (templateId && !template) throw notFound(`template ${templateId}`);
		const bot = await createBot(env, principal, {
			...(template ? { purpose: template.description, instructions: template.instructions, avatar: template.avatar, appIds: template.connectors } : {}),
			...defined(fields),
			name: fields.name,
		});
		// A template's routines arrive paused, with no trigger until the user adds one.
		for (const routine of template?.routines ?? [])
			await botOf(env, bot.id).createRoutine(principal, { name: routine.name, prompt: routine.prompt, triggers: [], grant: { actions: [], targets: [], limits: {} }, active: false });
		return bot;
	},
	getBot: async (env, principal, { botId }) => botEntity(env, principal, await ownedBot(env, principal, botId)),
	updateBot: async (env, principal, { botId, ...patch }) => {
		await ownedBot(env, principal, botId);
		const { pinned, archived, sectionId, unread, needsYou, ...settings } = defined(patch) as Partial<Bot>;
		if (Object.keys(settings).length > 0) await botOf(env, botId).updateFromClient(principal, settings);
		const flags = defined({ pinned, archived, sectionId, unread, needsYou });
		if (Object.keys(flags).length > 0) await userOf(env, principal).setBotFlags(botId, flags);
		return changed(env, principal, botId);
	},
	duplicateBot: async (env, principal, { botId }) => {
		const source = await botEntity(env, principal, await ownedBot(env, principal, botId));
		return createBot(env, principal, {
			name: `${source.name} copy`,
			model: source.model,
			purpose: source.purpose,
			instructions: source.instructions,
			avatar: source.avatar,
			approvals: source.approvals,
			computerAccess: source.computerAccess,
			notify: source.notify,
			suggestions: source.suggestions,
			showTools: source.showTools,
			appIds: source.appIds,
		});
	},
	archiveBot: async (env, principal, { botId }) => {
		await userOf(env, principal).setBotFlags(await ownedBot(env, principal, botId), { archived: true, pinned: false });
		return changed(env, principal, botId);
	},
	restoreBot: async (env, principal, { botId }) => {
		await userOf(env, principal).setBotFlags(await ownedBot(env, principal, botId), { archived: false });
		return changed(env, principal, botId);
	},
	markUnread: async (env, principal, { botId, unread }) => {
		const current = await botEntity(env, principal, await ownedBot(env, principal, botId));
		await userOf(env, principal).setBotFlags(botId, { unread: unread ? Math.max(1, current.unread) : 0 });
		return changed(env, principal, botId);
	},
	setSections: async (env, principal, { sections }) => ({ sections: await userOf(env, principal).setSections(sections) }),
	listInstructionVersions: async (env, principal, { botId }) => ({
		versions: await botOf(env, await ownedBot(env, principal, botId)).instructionVersions(principal),
	}),
	restoreInstructions: async (env, principal, { botId, version }) => {
		const versions = await botOf(env, await ownedBot(env, principal, botId)).instructionVersions(principal);
		const found = versions.find((candidate) => candidate.version === version);
		if (!found) throw notFound(`version ${version}`);
		await botOf(env, botId).updateFromClient(principal, { instructions: found.text });
		return changed(env, principal, botId);
	},
	setBotApps: async (env, principal, { botId, appIds }) => {
		await botOf(env, await ownedBot(env, principal, botId)).updateFromClient(principal, { appIds });
		return changed(env, principal, botId);
	},
	claimBotAddress: async (env, principal, { botId, local }) => {
		const result = checkName(local);
		if (result !== "ok") return { result };
		const account = await userOf(env, principal).account();
		try {
			const address = await claimBotAddress(env.DB, { address: `${local}.${account.handle ?? "you"}@${MAIL_DOMAIN}`, botId: await ownedBot(env, principal, botId), accountId: principal.accountId });
			await changed(env, principal, botId);
			return { result: "ok", address };
		} catch (error) {
			if (error instanceof AddressRefused) return { result: "taken" };
			throw error;
		}
	},
	listTemplates: async () => ({ templates: TEMPLATES }),
	exportBot: async (env, principal, { botId }) => (await botOf(env, await ownedBot(env, principal, botId)).exportData(principal)).recipe as RouteResponse<"exportBot">,
	listManagedBots: async (env, principal, { botId }) => {
		await ownedBot(env, principal, botId);
		const rows = await env.DB.prepare("SELECT id FROM bots WHERE account_id = ? AND managed_by = ?").bind(principal.accountId, botId).all<{ id: string }>();
		return { bots: await Promise.all(rows.results.map((row) => botEntity(env, principal, row.id))) };
	},
	setManagedBots: async (env, principal, { botId, botIds }) => {
		await ownedBot(env, principal, botId);
		for (const id of botIds) await ownedBot(env, principal, id);
		await env.DB.batch([
			env.DB.prepare("UPDATE bots SET managed_by = NULL WHERE account_id = ? AND managed_by = ?").bind(principal.accountId, botId),
			...botIds.map((id) => env.DB.prepare("UPDATE bots SET managed_by = ? WHERE id = ? AND account_id = ?").bind(botId, id, principal.accountId)),
		]);
		return { bots: await Promise.all(botIds.map((id) => changed(env, principal, id))) };
	},
};

export { createBot };
