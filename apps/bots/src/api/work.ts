// Routines, runs and usage; pages; the inbox and tasks.
import type { Page } from "@knightcode/bots-protocol";
import type { Principal } from "../auth/session.ts";
import type { Env } from "../env.ts";
import { accountBotIds } from "./bots.ts";
import { botOf, defined, type Handlers, notFound, ownedBot, userOf } from "./http.ts";

/** The bot holding routine `id` (routines live in their bot). */
async function routineBot(env: Env, principal: Principal, id: string): Promise<string> {
	for (const botId of await accountBotIds(env, principal)) if (await botOf(env, botId).hasRoutine(principal, id)) return botId;
	throw notFound(`routine ${id}`);
}

export const workHandlers: Handlers = {
	listRoutines: async (env, principal, { botId }) => {
		const ids = botId ? [await ownedBot(env, principal, botId)] : await accountBotIds(env, principal);
		const routines = [];
		for (const id of ids) routines.push(...(await botOf(env, id).clientRoutines(principal)));
		return { routines };
	},
	getRoutine: async (env, principal, { id }) => {
		const routine = (await botOf(env, await routineBot(env, principal, id)).clientRoutines(principal)).find((candidate) => candidate.id === id);
		if (!routine) throw notFound(`routine ${id}`);
		return routine;
	},
	createRoutine: async (env, principal, { botId, ...fields }) => botOf(env, await ownedBot(env, principal, botId)).createClientRoutine(principal, fields),
	updateRoutine: async (env, principal, { id, ...patch }) => botOf(env, await routineBot(env, principal, id)).updateClientRoutine(principal, id, defined(patch)),
	deleteRoutine: async (env, principal, { id }) => {
		await botOf(env, await routineBot(env, principal, id)).deleteRoutine(principal, id);
		return { ok: true };
	},
	testRoutine: async (env, principal, { id }) => botOf(env, await routineBot(env, principal, id)).testRoutine(principal, id),
	mintWebhook: async (env, principal, { id }) => botOf(env, await routineBot(env, principal, id)).mintWebhook(principal, id),
	estimateWatch: async (_env, _principal, { trigger }) => {
		if (trigger.kind !== "watch" || trigger.target === "connector") return { computerHoursPerMonth: 0 };
		// Checks that need the computer run at most hourly while it sleeps; each wakes it for one 5-minute block.
		const checksPerMonth = (30 * 24 * 60) / Math.max(60, trigger.everyMinutes);
		return { computerHoursPerMonth: Math.round(((checksPerMonth * 5) / 60) * 10) / 10 };
	},
	listRuns: async (env, principal, filter) => {
		const ids = filter.botId ? [await ownedBot(env, principal, filter.botId)] : await accountBotIds(env, principal);
		const runs = [];
		for (const id of ids) runs.push(...(await botOf(env, id).clientRuns(principal, filter)));
		return { runs: runs.sort((a, b) => b.startedAt - a.startedAt) };
	},
	stopRun: async (env, principal, { id }) => {
		for (const botId of await accountBotIds(env, principal)) {
			const run = await botOf(env, botId).stopClientRun(principal, id);
			if (run) return run;
		}
		throw notFound(`run ${id}`);
	},
	listUsage: async (env, principal, { from, to }) => ({ rows: await userOf(env, principal).usageRows(from, to) }),

	listPages: async (env, principal, { q }) => ({ pages: await userOf(env, principal).pageList(q ?? "") }),
	getPage: async (env, principal, { id }) => {
		const page = await userOf(env, principal).pageGet(id);
		if (!page) throw notFound(`page ${id}`);
		return page;
	},
	updatePage: async (env, principal, { id, baseVersion, ...patch }) =>
		userOf(env, principal).pageUpdate(id, { kind: "user" }, { ...defined(patch), baseVersion }),
	getPageVersion: async (env, principal, { id, version }) => {
		const page = await userOf(env, principal).pageVersion(id, Number(version));
		if (!page) throw notFound(`version ${version} of ${id}`);
		return page;
	},
	restorePageVersion: async (env, principal, { id, version }) => userOf(env, principal).pageRestore(id, Number(version)),
	listPageVersions: async (env, principal, { id }) => ({ versions: await userOf(env, principal).pageVersions(id) }),
	pressPageButton: async (env, principal, { id, blockId }) => {
		// The page as the contract types it (the RPC stub's mapped type loses the block union).
		const page = (await userOf(env, principal).pageGet(id)) as Page | undefined;
		const block = page?.blocks.find((candidate) => candidate.id === blockId);
		if (!page || block?.type !== "button") throw notFound(`button ${blockId}`);
		return botOf(env, page.ownerBotId).pressButton(principal, block.action, block.label);
	},
	exportPage: async (env, principal, { id, format }) => ({ fileId: await userOf(env, principal).pageExport(id, format) }),

	listInbox: async (env, principal) => userOf(env, principal).inboxAll(),
	updateInboxItem: async (env, principal, { id, ...patch }) => {
		const item = await userOf(env, principal).inboxMark(id, defined(patch));
		if (!item) throw notFound(`inbox item ${id}`);
		await userOf(env, principal).broadcast({ kind: "inbox", item });
		return item;
	},
	createTask: async (env, principal, fields) => userOf(env, principal).taskAdd({ ...fields, source: "user" }),
	updateTask: async (env, principal, { id, ...patch }) => userOf(env, principal).taskUpdate(id, defined(patch)),
};
