// The computer, connectors and skills.
import { importFromGitHub, NoSkills } from "../skills/github-import.ts";
import { botOf, type Handlers, HttpError, notFound, ownedBot, userOf } from "./http.ts";

const computerOf = (env: Parameters<typeof userOf>[0], accountId: string) => env.COMPUTER.get(env.COMPUTER.idFromName(accountId));

export const workspaceHandlers: Handlers = {
	getComputer: async (env, principal) => computerOf(env, principal.accountId).clientState(),
	getScreen: async (env, principal, { botId, mode }) => computerOf(env, principal.accountId).screenUrl(principal, await ownedBot(env, principal, botId), mode),
	setControl: async (env, principal, { botId, take }) => {
		const state = await computerOf(env, principal.accountId).setControl(await ownedBot(env, principal, botId), take);
		await userOf(env, principal).broadcast({ kind: "computer", state });
		return state;
	},
	runMaintenance: async (env, principal, { action }) => {
		const state = await computerOf(env, principal.accountId).startMaintenance(action);
		await userOf(env, principal).broadcast({ kind: "computer", state });
		return state;
	},
	getSetupScript: async (env, principal) => ({ script: await computerOf(env, principal.accountId).setupScript() }),
	putSetupScript: async (env, principal, { script }) => {
		await computerOf(env, principal.accountId).setSetupScript(principal, script);
		return { script };
	},
	protectedInput: async (env, principal, { botId, value }) => {
		await computerOf(env, principal.accountId).protectedInput(await ownedBot(env, principal, botId), value);
		return { ok: true };
	},
	startTeaching: async (env, principal, { botId, goal }) => botOf(env, await ownedBot(env, principal, botId)).startTeachingFromClient(principal, goal),
	stopTeaching: async (env, principal, { botId, sessionId }) => botOf(env, await ownedBot(env, principal, botId)).stopTeachingFromClient(principal, sessionId),

	listCatalog: async (env, principal, filter) => ({ entries: await userOf(env, principal).catalog(filter) }),
	getCatalogEntry: async (env, principal, { appId }) => {
		const entry = (await userOf(env, principal).catalog({})).find((candidate) => candidate.id === appId);
		if (!entry) throw notFound(`app ${appId}`);
		return entry;
	},
	listAppEvents: async (env, principal, { appId }) => ({ events: await userOf(env, principal).appEvents(appId) }),
	connectApp: async (env, principal, { appId, skills, apiKey }) => userOf(env, principal).connectApp(appId, { skills, ...(apiKey ? { apiKey } : {}) }),
	disconnectApp: async (env, principal, { appId }) => {
		await userOf(env, principal).disconnectApp(appId);
		return { ok: true };
	},
	updateConnection: async (env, principal, { appId, ...patch }) => userOf(env, principal).updateConnection(appId, patch),
	addCustomServer: async (env, principal, { name, url }) => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new HttpError(400, "invalid", "not a URL");
		}
		if (parsed.protocol !== "https:") throw new HttpError(400, "invalid", "a remote MCP server is reached over https");
		return userOf(env, principal).addCustomServer(name, parsed.href);
	},

	listSkills: async (env, principal, filter) => ({ skills: await userOf(env, principal).skillList(filter) }),
	createSkill: async (env, principal, { botId, ...fields }) => {
		if (botId) await ownedBot(env, principal, botId);
		return userOf(env, principal).skillAdd({ ...fields, scope: botId ? "bot" : "user", ...(botId ? { botId } : {}) });
	},
	updateSkill: async (env, principal, { id, ...patch }) => userOf(env, principal).skillUpdate(id, patch),
	deleteSkill: async (env, principal, { id }) => {
		await userOf(env, principal).skillDelete(id);
		return { ok: true };
	},
	shareSkill: async (env, principal, { id }) => userOf(env, principal).skillShare(id),
	previewGitHubSkills: async (_env, _principal, { url }) => {
		try {
			return { skills: await importFromGitHub(url) };
		} catch (error) {
			if (error instanceof NoSkills) throw new HttpError(404, "no_skills", "that repository has no skills");
			throw new HttpError(400, "not_github", "paste a GitHub repository URL");
		}
	},
	addGitHubSkills: async (env, principal, { url, names }) => {
		const drafts = (await importFromGitHub(url)).filter((draft) => names.includes(draft.name));
		const skills = [];
		for (const draft of drafts) skills.push(await userOf(env, principal).skillAdd({ ...draft, scope: "user" }));
		return { skills };
	},
};
