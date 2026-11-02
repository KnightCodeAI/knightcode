// A bot's thread and what hangs off it: history, reactions, exchanges with other bots, card answers, files, approvals,
// notes and open work. Each call goes to the bot object, which checks the principal owns it.
import type { RouteResponse } from "@knightcode/bots-protocol";
import { guardedFetch } from "../connectors/guarded-fetch.ts";
import { accountBotIds, botEntity } from "./bots.ts";
import { botOf, type Handlers, HttpError, notFound, ownedBot, userOf } from "./http.ts";

export const threadHandlers: Handlers = {
	getHistory: async (env, principal, { botId, before, limit }) => botOf(env, await ownedBot(env, principal, botId)).history(principal, before, limit),
	react: async (env, principal, { botId, entryId, emoji }) => {
		await botOf(env, await ownedBot(env, principal, botId)).react(principal, entryId, emoji);
		return { ok: true };
	},
	getExchange: async (env, principal, { botId, entryId }) =>
		(await botOf(env, await ownedBot(env, principal, botId)).exchange(principal, entryId)) as RouteResponse<"getExchange">,
	appAction: async (env, principal, { botId, entryId, action }) => botOf(env, await ownedBot(env, principal, botId)).appAction(principal, entryId, action),
	discardSkillDraft: async (env, principal, { botId, entryId }) => {
		await botOf(env, await ownedBot(env, principal, botId)).answerCard(principal, entryId, { type: "discard-skill" });
		return { ok: true };
	},
	answerSecretRequest: async (env, principal, { botId, entryId, value }) => {
		await botOf(env, await ownedBot(env, principal, botId)).answerCard(principal, entryId, { type: "secret", ...(value ? { value } : {}) });
		return { ok: true };
	},
	answerSuggestion: async (env, principal, { id, accept }) => {
		for (const botId of await accountBotIds(env, principal))
			if (await botOf(env, botId).answerSuggestion(principal, id, accept)) return { ok: true };
		throw notFound(`suggestion ${id}`);
	},
	undoSettingsChange: async (env, principal, { botId, entryId }) => {
		await botOf(env, await ownedBot(env, principal, botId)).answerCard(principal, entryId, { type: "undo" });
		return botEntity(env, principal, botId);
	},
	saveSkillDraft: async (env, principal, { botId, entryId, ...draft }) =>
		botOf(env, await ownedBot(env, principal, botId)).saveSkillDraft(principal, entryId, draft),
	linkPreview: async (_env, _principal, { url }) => {
		let host: string | undefined;
		try {
			host = new URL(url).host;
		} catch {
			throw new HttpError(400, "invalid", "not a URL");
		}
		// Public pages only, through the guarded fetch; a preview is a title at most.
		try {
			const response = await guardedFetch(url, { headers: { accept: "text/html" } }, { allowPrivate: [] });
			const html = (await response.text()).slice(0, 200_000);
			const meta = (name: string) =>
				new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i").exec(html)?.[1];
			const title = meta("og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
			const description = meta("og:description") ?? meta("description");
			return { ...(title ? { title } : {}), site: host, ...(description ? { description } : {}) };
		} catch {
			return { site: host };
		}
	},
	uploadFile: async (env, principal, { data, ...meta }) => {
		const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
		if (meta.botId) await ownedBot(env, principal, meta.botId);
		return userOf(env, principal).putFile({ name: meta.name, kind: meta.kind ?? "attachment", ...(meta.botId ? { botId: meta.botId } : {}), mime: meta.mime }, bytes);
	},
	listFiles: async (env, principal, filter) => ({ files: await userOf(env, principal).listFiles(filter) }),
	getFile: async (env, principal, { id }) => {
		const ref = await userOf(env, principal).fileRef(id);
		if (!ref) throw notFound(`file ${id}`);
		return { file: ref, url: await userOf(env, principal).fileUrl(id) };
	},
	deleteFile: async (env, principal, { id }) => {
		await userOf(env, principal).deleteFile(id);
		return { ok: true };
	},
	listApprovals: async (env, principal, { botId }) => {
		const ids = botId ? [await ownedBot(env, principal, botId)] : await accountBotIds(env, principal);
		const approvals = [];
		for (const id of ids) approvals.push(...(await botOf(env, id).clientApprovals(principal)));
		return { approvals };
	},
	answerApproval: async (env, principal, { id, decision, passkey }) => {
		for (const botId of await accountBotIds(env, principal)) {
			const answered = await botOf(env, botId).answerClientApproval(principal, id, decision, passkey);
			if (answered) return answered as RouteResponse<"answerApproval">;
		}
		throw notFound(`approval ${id}`);
	},

	listNotes: async (env, principal, { botId }) => ({ notes: await botOf(env, await ownedBot(env, principal, botId)).notes(principal) }),
	getNote: async (env, principal, { botId, name }) => {
		const note = (await botOf(env, await ownedBot(env, principal, botId)).notes(principal)).find((candidate) => candidate.name === name);
		if (!note) throw notFound(`note ${name}`);
		return note;
	},
	deleteNote: async (env, principal, { botId, name }) => {
		await botOf(env, await ownedBot(env, principal, botId)).deleteNote(principal, name);
		return { ok: true };
	},
	shareNotes: async (env, principal, { botId, names }) => {
		const moved = await botOf(env, await ownedBot(env, principal, botId)).takeNotesToShare(principal, names);
		await userOf(env, principal).addSharedNotes(moved.notes);
		return { shared: moved.notes.length, keptPrivate: moved.keptPrivate };
	},
	getSharedMemory: async (env, principal) => userOf(env, principal).sharedMemory(),
	listOpenWork: async (env, principal, { botId }) => ({ items: await botOf(env, await ownedBot(env, principal, botId)).openWork(principal) }),
	addOpenWork: async (env, principal, { botId, text }) => botOf(env, await ownedBot(env, principal, botId)).openWorkAdd(principal, text),
	updateOpenWork: async (env, principal, { botId, id, ...patch }) => {
		const item = await botOf(env, await ownedBot(env, principal, botId)).openWorkUpdate(principal, id, patch);
		if (!item) throw notFound(`open work item ${id}`);
		return item;
	},
	deleteOpenWork: async (env, principal, { botId, id }) => {
		await botOf(env, await ownedBot(env, principal, botId)).openWorkDelete(principal, id);
		return { ok: true };
	},
};
