// An in-memory KnightCode Bots backend that serves every route and frame, for UI work and tests.
import { matchRoute, queryToRequest, type RouteName, type RouteRequest, type RouteResponse } from "../api.ts";
import { AVATAR_COLORS, AVATAR_SHAPES, type AvatarShape } from "../avatars.ts";
import {
	type Approval,
	type Bot,
	checkName,
	type ConversationView,
	type Entry,
	type InboxItem,
	type Page,
	type Run,
	type Skill,
} from "../entities.ts";
import type { WebSocketLike } from "../frames.ts";
import { parse, ProtocolError } from "../validate.ts";
import { defaultSeed, type FakeSeed } from "./seed.ts";
import { FakeHub, type ThreadKey } from "./socket.ts";
import { type FakeClock, manualClock } from "./stream.ts";

export { defaultSeed, type FakeSeed, seedFrom } from "./seed.ts";
export { FAKE_EPOCH, type FakeClock, manualClock, realtimeClock, WORD_MS } from "./stream.ts";

export interface FakeBackend {
	/** The seed the backend started from; the live state is a copy. */
	readonly seed: FakeSeed;
	readonly state: FakeSeed;
	readonly clock: FakeClock;
	/** Serves every route in `ROUTES`, like the Worker. */
	fetch: typeof globalThis.fetch;
	connect(): WebSocketLike;
	/** How many times an approved action ran. */
	executed(approvalId: string): number;
}

/** A failed request: the status and the `error` code the client sees. */
class FakeHttpError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message?: string) {
		super(message ?? code);
		this.status = status;
		this.code = code;
	}
}

type Handlers = { [N in RouteName]: (request: RouteRequest<N>) => RouteResponse<N> | Promise<RouteResponse<N>> };

const APP_EVENTS: Record<string, { id: string; name: string; description: string }[]> = {
	gmail: [
		{ id: "new_message", name: "New email", description: "A message arrives in the inbox" },
		{ id: "new_label", name: "Email labeled", description: "A label is added to a message" },
	],
	"google-calendar": [{ id: "event_starting", name: "Event starting", description: "An event starts in 10 minutes" }],
	hubspot: [{ id: "deal_stage", name: "Deal stage changed", description: "A deal moves to another stage" }],
};

const DEFAULT_REPLY = "On it. I'll work through this and report back here with what I find.";
const FEE_RATE = 0.029;
const FEE_FIXED = 0.3;
const CREDIT_MARKUP = 1.1;

/** Builds a fake backend from a seed (the default world when omitted). */
export function createFakeBackend(seed: FakeSeed = defaultSeed(), options: { clock?: FakeClock } = {}): FakeBackend {
	const state: FakeSeed = structuredClone(seed);
	const clock = options.clock ?? manualClock();
	const executions = new Map<string, number>();
	const enrollments = new Map<string, { provider: string; expiresAt: number }>();
	const pageHistory = new Map<string, Page[]>();
	let counter = 0;
	const newId = (prefix: string) => `${prefix}-${++counter}`;
	const now = () => clock.now();

	// The hub gets its own copy: seed objects shared with `state` must change only through ops.
	const hub: FakeHub = new FakeHub(structuredClone(state.threads), {
		clock,
		accountId: state.account.id,
		replyFor: (botId) => state.replies[botId] ?? DEFAULT_REPLY,
		group: (groupId) => {
			const group = state.groups.find((g) => g.id === groupId);
			if (!group) return undefined;
			const names = Object.fromEntries(state.bots.map((b) => [b.id, b.name]));
			return { memberIds: group.memberIds, leadId: group.leadId, names };
		},
		onRunState: (botId, running) => {
			const bot = state.bots.find((b) => b.id === botId);
			if (!bot) return;
			bot.status = running ? "working" : "idle";
			bot.lastActivityAt = now();
			hub.emit({ kind: "bot", bot });
		},
		onAnswered: (entryId) => settleInbox((item) => item.entryId === entryId),
	});
	// The hub owns thread views from here on; `state.threads` would go stale.
	const threadView = (key: ThreadKey) => hub.view(key);

	const find = <T extends { id: string }>(list: T[], id: string, what: string): T => {
		const item = list.find((entry) => entry.id === id);
		if (!item) throw new FakeHttpError(404, "not_found", `no ${what} ${id}`);
		return item;
	};
	const bot = (id: string) => find(state.bots, id, "bot");
	const changed = (b: Bot) => {
		hub.emit({ kind: "bot", bot: b });
		return b;
	};

	/** Marks matching inbox items done, and clears needs-you on bots with nothing left to answer. */
	function settleInbox(match: (item: InboxItem) => boolean): void {
		for (const item of state.inbox.filter(match)) {
			item.done = true;
			item.read = true;
			hub.emit({ kind: "inbox", item });
			const waiting = state.inbox.some(
				(other) =>
					other.botId === item.botId && !other.done && (other.kind === "approval" || other.kind === "question"),
			);
			const owner = state.bots.find((b) => b.id === item.botId);
			if (owner && owner.needsYou && !waiting) changed(Object.assign(owner, { needsYou: false }));
		}
	}

	function slug(name: string, taken: (candidate: string) => boolean): string {
		const base =
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") || "bot";
		let candidate = base;
		for (let n = 2; taken(candidate); n++) candidate = `${base}-${n}`;
		return candidate;
	}

	/** The model a request named, else the user's chosen default; the fake never picks one itself. */
	function chosenModel(model: Bot["model"] | undefined): Bot["model"] {
		const chosen = model ?? state.account.defaultModel;
		if (!chosen) throw new FakeHttpError(400, "model_required", "choose a model for this bot");
		return chosen;
	}

	function makeBot(fields: Partial<Bot> & Pick<Bot, "name" | "model">): Bot {
		const id = slug(fields.name, (candidate) => state.bots.some((b) => b.id === candidate));
		const shape: AvatarShape = AVATAR_SHAPES[state.bots.length % AVATAR_SHAPES.length]!;
		const created: Bot = {
			id,
			purpose: "",
			instructions: "",
			instructionsVersion: 1,
			avatar: { shape, color: "blue" },
			approvals: "default",
			computerAccess: true,
			notify: "input",
			suggestions: false,
			showTools: false,
			appIds: [],
			status: "idle",
			pinned: false,
			archived: false,
			unread: 0,
			needsYou: false,
			createdAt: now(),
			...fields,
		};
		state.bots.push(created);
		// The address comes from the name only when it is valid and free; otherwise the user picks one.
		const local = slug(created.name, () => false);
		const address = `${local}.${state.account.handle ?? "you"}@bots.knightcode.dev`;
		if (!created.email && checkName(local) === "ok" && !state.channels.addresses.some((a) => a.address === address)) {
			created.email = address;
			state.channels.addresses.push({ botId: id, address });
		}
		state.instructionVersions[id] = [
			{ version: 1, text: created.instructions, createdAt: now(), author: { kind: "user" } },
		];
		return changed(created);
	}

	function updateBot(id: string, patch: Partial<Bot>): Bot {
		const target = bot(id);
		const fields = defined(patch);
		if (fields.instructions !== undefined && fields.instructions !== target.instructions) {
			target.instructionsVersion += 1;
			(state.instructionVersions[id] ??= []).push({
				version: target.instructionsVersion,
				text: fields.instructions,
				createdAt: now(),
				author: { kind: "user" },
			});
		}
		return changed(Object.assign(target, fields));
	}

	function startRun(botId: string, title: string, routineId?: string): Run {
		const run: Run = {
			id: newId("run"),
			botId,
			routineId,
			title,
			startedBy: routineId ? "routine" : "user",
			status: "running",
			startedAt: now(),
		};
		state.runs.unshift(run);
		clock.setTimeout(() => {
			if (run.status !== "running") return;
			run.status = "succeeded";
			run.endedAt = now();
		}, 1_500);
		return run;
	}

	const message = (entry: Entry) => (entry.kind === "message" ? entry : undefined);

	const handlers: Handlers = {
		// Account, session, onboarding, search
		getAccount: () => state.account,
		updateAccount: (request) => Object.assign(state.account, defined(request)),
		claimHandle: ({ handle }) => {
			const result = checkName(handle);
			if (result !== "ok") return { result };
			state.account.handle = handle;
			return { result: "ok" };
		},
		listSignInMethods: () => state.signIn,
		beginPasskey: () => ({ options: { challenge: "fake-challenge" } }),
		addPasskey: ({ name }) => {
			const passkey = { id: newId("pk"), name, createdAt: now() };
			state.signIn.passkeys.push(passkey);
			return passkey;
		},
		deletePasskey: ({ id }) => {
			state.signIn.passkeys = state.signIn.passkeys.filter((p) => p.id !== id);
			return { ok: true };
		},
		exportAccount: () => ({ fileId: newId("export") }),
		deleteAccount: ({ confirm }) => {
			if (confirm !== state.account.handle)
				throw new FakeHttpError(400, "confirm_mismatch", "type your handle to confirm");
			return { ok: true };
		},
		issueTicket: () => ({ ticket: newId("ticket"), expiresAt: now() + 60_000 }),
		getOnboarding: () => state.onboarding,
		getCatchUp: () => ({ catchUp: state.catchUp }),
		search: ({ q }) => {
			const needle = q.toLowerCase();
			const hits: RouteResponse<"search">["hits"] = [];
			for (const b of state.bots)
				if (b.name.toLowerCase().includes(needle))
					hits.push({ kind: "bot", id: b.id, botId: b.id, title: b.name, snippet: b.purpose });
			for (const g of state.groups)
				if (g.name.toLowerCase().includes(needle)) hits.push({ kind: "group", id: g.id, groupId: g.id, title: g.name });
			for (const b of state.bots)
				for (const entry of threadView(`bot:${b.id}`).entries) {
					const m = message(entry);
					if (m?.text.toLowerCase().includes(needle))
						hits.push({ kind: "message", id: m.id, botId: b.id, title: b.name, snippet: m.text.slice(0, 140) });
				}
			for (const p of state.pages)
				if (p.title.toLowerCase().includes(needle)) hits.push({ kind: "page", id: p.id, title: p.title });
			for (const s of state.skills)
				if (s.name.toLowerCase().includes(needle))
					hits.push({ kind: "skill", id: s.id, title: s.name, snippet: s.description });
			return { hits };
		},
		subscribePush: () => ({ ok: true }),
		unsubscribePush: () => ({ ok: true }),

		// Model providers and models
		listProviders: () => ({ providers: state.providers }),
		connectProvider: ({ provider }) => {
			const live = state.providers.find((p) => p.provider === provider);
			if (!live) throw new FakeHttpError(404, "not_found", `no provider ${provider}`);
			live.status = "connected";
			return live;
		},
		beginEnrollment: ({ provider }) => {
			if (!state.providers.some((p) => p.provider === provider))
				throw new FakeHttpError(404, "not_found", `no provider ${provider}`);
			const token = newId("enroll");
			const expiresAt = now() + 10 * 60_000;
			enrollments.set(token, { provider, expiresAt });
			return { token, expiresAt };
		},
		completeEnrollment: ({ provider, token }) => {
			const enrollment = enrollments.get(token);
			// Single use: the token is gone whether or not it was still valid.
			enrollments.delete(token);
			if (!enrollment || enrollment.provider !== provider || now() > enrollment.expiresAt)
				throw new FakeHttpError(410, "enrollment_expired", "start connecting again");
			const live = state.providers.find((p) => p.provider === provider)!;
			live.status = "connected";
			return live;
		},
		disconnectProvider: ({ provider }) => {
			const live = state.providers.find((p) => p.provider === provider);
			if (live) live.status = "available";
			return { ok: true };
		},
		listModels: () => ({ models: state.models }),

		// Bots and the sidebar
		listBots: ({ archived }) => ({
			bots: state.bots.filter((b) => b.archived === (archived ?? false)),
			groups: state.groups,
			sections: state.sections,
		}),
		createBot: ({ templateId, ...fields }) => {
			const template = templateId ? state.templates.find((t) => t.id === templateId) : undefined;
			return makeBot({
				...(template
					? {
							purpose: template.description,
							instructions: template.instructions,
							avatar: template.avatar,
							appIds: template.connectors,
						}
					: {}),
				...defined(fields),
				name: fields.name,
				model: chosenModel(fields.model),
			});
		},
		getBot: ({ botId }) => bot(botId),
		updateBot: ({ botId, ...patch }) => updateBot(botId, patch),
		duplicateBot: ({ botId }) => {
			const { id: _id, email: _email, ...source } = bot(botId);
			return makeBot({
				...structuredClone(source),
				name: `${source.name} copy`,
				unread: 0,
				needsYou: false,
				pinned: false,
			});
		},
		archiveBot: ({ botId }) => updateBot(botId, { archived: true, pinned: false }),
		restoreBot: ({ botId }) => updateBot(botId, { archived: false }),
		markUnread: ({ botId, unread }) => updateBot(botId, { unread: unread ? Math.max(1, bot(botId).unread) : 0 }),
		setSections: ({ sections }) => {
			state.sections = sections;
			return { sections };
		},
		listInstructionVersions: ({ botId }) => ({ versions: state.instructionVersions[bot(botId).id] ?? [] }),
		restoreInstructions: ({ botId, version }) => {
			const found = (state.instructionVersions[botId] ?? []).find((v) => v.version === version);
			if (!found) throw new FakeHttpError(404, "not_found", `no version ${version}`);
			return updateBot(botId, { instructions: found.text });
		},
		setBotApps: ({ botId, appIds }) => updateBot(botId, { appIds }),
		claimBotAddress: ({ botId, local }) => {
			const result = checkName(local);
			if (result !== "ok") return { result };
			const address = `${local}.${state.account.handle ?? "you"}@bots.knightcode.dev`;
			if (state.bots.some((b) => b.id !== botId && b.email === address)) return { result: "taken" };
			updateBot(botId, { email: address });
			state.channels.addresses = state.channels.addresses.filter((a) => a.botId !== botId).concat({ botId, address });
			return { result: "ok", address };
		},
		listTemplates: () => ({ templates: state.templates }),
		exportBot: ({ botId }) => {
			const source = bot(botId);
			return {
				profile: {
					name: source.name,
					description: source.instructions,
					avatarColor: source.avatar.color,
					avatarShape: source.avatar.shape,
				},
				memory: (state.notes[botId] ?? []).map((n) => ({
					kind: "profile" as const,
					content: `${n.description}: ${n.body}`,
				})),
				skills: state.skills
					.filter((s) => s.botId === botId)
					.map((s) => ({ name: s.name, description: s.description, content: s.content })),
				routines: state.routines
					.filter((r) => r.botId === botId)
					.map((r) => ({ name: r.name, slug: slug(r.name, () => false), description: r.name, content: r.prompt })),
				plugins: source.appIds.map((appId) => ({
					name: state.catalog.find((e) => e.id === appId)?.name ?? appId,
					pluginId: appId,
				})),
			};
		},
		importRecipe: (request) => {
			const { recipe } = request;
			const shape = AVATAR_SHAPES.find((s) => s === recipe.profile.avatarShape);
			const created = makeBot({
				name: recipe.profile.name,
				model: chosenModel(request.model),
				instructions: recipe.profile.description,
				// Recipes carry any CSS colour; only a palette name survives, otherwise the default blue.
				...(shape
					? { avatar: { shape, color: AVATAR_COLORS.find((c) => c === recipe.profile.avatarColor) ?? "blue" } }
					: {}),
			});
			const ticked = <T>(list: T[], indexes: number[]) => list.filter((_, index) => indexes.includes(index));
			// Another person's memory never reaches shared memory.
			const shared = request.origin === "self" ? request.sharedMemory : [];
			for (const [index, item] of recipe.memory.entries()) {
				if (!request.memory.includes(index) && !shared.includes(index)) continue;
				const note = {
					name: `imported-${index + 1}`,
					description: item.content.slice(0, 60),
					type: "fact" as const,
					body: item.content,
					updatedAt: now(),
					shared: shared.includes(index),
					outside: request.origin === "other",
				};
				if (note.shared) state.sharedMemory.notes.push(note);
				else (state.notes[created.id] ??= []).push(note);
			}
			for (const skill of ticked(recipe.skills, request.skills))
				state.skills.push({ id: newId("sk"), ...skill, scope: "user", updatedAt: now() });
			for (const routine of ticked(recipe.routines, request.routines))
				state.routines.push({
					id: newId("rt"),
					botId: created.id,
					name: routine.name,
					prompt: routine.content,
					triggers: [],
					grant: { actions: [], targets: [], limits: {} },
					active: false,
					note: routine.description,
				});
			const catalogIds = new Set(state.catalog.map((e) => e.id));
			const plugins = ticked(recipe.plugins, request.plugins);
			const matched = plugins.map((p) =>
				catalogIds.has(p.pluginId)
					? p.pluginId
					: state.catalog.find((e) => e.name.toLowerCase() === p.name.toLowerCase())?.id,
			);
			updateBot(created.id, { appIds: matched.filter((id): id is string => id !== undefined) });
			if (request.runSetup && recipe.gettingStarted)
				hub.commit(`bot:${created.id}`, [
					[
						"p",
						["entries"],
						0,
						0,
						[
							{
								kind: "card",
								id: newId("card"),
								createdAt: now(),
								card: { type: "run-setup", skill: recipe.gettingStarted.skill },
							},
						],
					],
				]);
			return {
				bot: bot(created.id),
				unmatchedPlugins: plugins.filter((_, index) => matched[index] === undefined).map((p) => p.name),
			};
		},
		listManagedBots: ({ botId }) => ({ bots: (state.managed[botId] ?? []).map(bot) }),
		setManagedBots: ({ botId, botIds }) => {
			state.managed[botId] = botIds;
			for (const id of botIds) updateBot(id, { managedBy: botId });
			return { bots: botIds.map(bot) };
		},

		// Conversations, files, approvals
		getHistory: ({ botId, before, limit }) => history(`bot:${bot(botId).id}`, before, limit),
		getGroupHistory: ({ groupId, before, limit }) =>
			history(`group:${find(state.groups, groupId, "group").id}`, before, limit),
		react: ({ botId, entryId, emoji }) => react(`bot:${bot(botId).id}`, entryId, emoji),
		reactInGroup: ({ groupId, entryId, emoji }) =>
			react(`group:${find(state.groups, groupId, "group").id}`, entryId, emoji),
		getExchange: ({ botId, entryId }) => {
			const entries = threadView(`bot:${bot(botId).id}`).entries;
			const row = entries.find((e) => e.id === entryId);
			if (row?.kind !== "bot-message") throw new FakeHttpError(404, "not_found", `no bot message ${entryId}`);
			const [from, to] = row.direction === "to" ? [botId, row.peerBotId] : [row.peerBotId, botId];
			// The other side of the exchange: the first assistant reply in this thread after the request.
			const reply = entries.find((e) => e.createdAt >= row.createdAt && e.kind === "message" && e.role === "assistant");
			const messages = [{ from, intent: row.intent, text: row.text, createdAt: row.createdAt }];
			if (reply?.kind === "message")
				messages.push({ from: to, intent: "result" as const, text: reply.text, createdAt: reply.createdAt });
			return { peerBotId: row.peerBotId, messages };
		},
		appAction: ({ botId, entryId }) => {
			const panel = threadView(`bot:${bot(botId).id}`).entries.find((e) => e.id === entryId);
			if (panel?.kind !== "card" || panel.card.type !== "app-panel")
				throw new FakeHttpError(404, "not_found", `no app panel ${entryId}`);
			// App actions take the same approval path as the model's own actions.
			const approval: Approval = {
				id: newId("appr"),
				botId,
				digest: `sha256:${newId("d")}`,
				action: { tool: `${panel.card.appId}.action`, title: `Run an action from ${panel.card.title}` },
				expiresAt: now() + 3_600_000,
				state: "pending",
			};
			state.approvals.push(approval);
			return { approval };
		},
		discardSkillDraft: ({ entryId }) => {
			hub.patchCards(
				(e) => e.id === entryId && e.kind === "card" && e.card.type === "skill-draft",
				(index) => [["s", ["entries", index, "card", "state"], "discarded"]],
			);
			return { ok: true };
		},
		answerSecretRequest: ({ botId, entryId, value }) => {
			const card = threadView(`bot:${bot(botId).id}`).entries.find((e) => e.id === entryId);
			if (card?.kind !== "card" || card.card.type !== "secret-request")
				throw new FakeHttpError(404, "not_found", `no secret request ${entryId}`);
			const { name, origin, kind } = card.card;
			hub.patchCards(
				(e) => e.id === entryId,
				(index) => [["s", ["entries", index, "card", "state"], value ? "saved" : "dismissed"]],
			);
			// The value is discarded here; the real backend seals it and never returns it.
			if (value) state.vault.push({ id: newId("v"), kind, name, origin, createdAt: now() });
			return { ok: true };
		},
		answerSuggestion: ({ id, accept }) => {
			hub.patchCards(
				(e) => e.kind === "card" && e.card.type === "suggestion" && e.card.suggestionId === id,
				(index) => [["s", ["entries", index, "card", "state"], accept ? "accepted" : "dismissed"]],
			);
			settleInbox(
				(item) =>
					item.kind === "suggestion" && item.entryId !== undefined && cardEntry(item.entryId)?.suggestionId === id,
			);
			return { ok: true };
		},
		undoSettingsChange: ({ botId, entryId }) => {
			hub.patchCards(
				(e) => e.id === entryId && e.kind === "card" && e.card.type === "settings-change",
				(index) => [["s", ["entries", index, "card", "undone"], true]],
			);
			return bot(botId);
		},
		saveSkillDraft: ({ botId, entryId, ...draft }) => {
			const skill: Skill = { id: newId("sk"), ...draft, scope: "bot", botId, updatedAt: now() };
			state.skills.push(skill);
			hub.patchCards(
				(e) => e.id === entryId && e.kind === "card" && e.card.type === "skill-draft",
				(index) => [["s", ["entries", index, "card", "state"], "saved"]],
			);
			return skill;
		},
		linkPreview: ({ url }) => {
			const host = safeHost(url);
			return { title: host ?? url, site: host, description: `A page on ${host ?? "the web"}` };
		},
		uploadFile: ({ data, ...meta }) => {
			const file = { id: newId("file"), ...meta, size: Math.floor((data.length * 3) / 4), createdAt: now() };
			state.files.push(file);
			return file;
		},
		listFiles: ({ botId, kind }) => ({
			files: state.files.filter(
				(f) => (botId === undefined || f.botId === botId) && (kind === undefined || f.kind === kind),
			),
		}),
		getFile: ({ id }) => ({ file: find(state.files, id, "file"), url: `/__fake/files/${encodeURIComponent(id)}` }),
		deleteFile: ({ id }) => {
			state.files = state.files.filter((f) => f.id !== id);
			return { ok: true };
		},
		listApprovals: ({ botId }) => {
			expireDue();
			return { approvals: state.approvals.filter((a) => botId === undefined || a.botId === botId) };
		},
		answerApproval: ({ id, decision }) => {
			const approval = find(state.approvals, id, "approval");
			expireDue();
			// Checked and consumed in one synchronous step, so two answers cannot both run the action.
			if (approval.state !== "pending") return { result: approval.state === "expired" ? "expired" : "used", approval };
			if (decision !== "deny") executions.set(id, (executions.get(id) ?? 0) + 1);
			if (decision === "always")
				state.approvalSettings.allow.push({ id: newId("rule"), kind: "tool", value: approval.action.tool });
			settleApproval(approval, decision === "deny" ? "denied" : "allowed");
			return { result: "ok", approval };
		},

		// Memory
		listNotes: ({ botId }) => ({ notes: state.notes[bot(botId).id] ?? [] }),
		getNote: ({ botId, name }) => {
			const note = (state.notes[botId] ?? []).find((n) => n.name === name);
			if (!note) throw new FakeHttpError(404, "not_found", `no note ${name}`);
			return note;
		},
		deleteNote: ({ botId, name }) => {
			state.notes[botId] = (state.notes[botId] ?? []).filter((n) => n.name !== name);
			return { ok: true };
		},
		shareNotes: ({ botId, names }) => {
			const notes = (state.notes[botId] ?? []).filter((n) => names.includes(n.name));
			// Notes that look private, or that outside text wrote, stay with the bot.
			const keep = notes.filter((n) => n.outside || /password|salary|address|phone|health/i.test(n.body));
			const move = notes.filter((n) => !keep.includes(n));
			state.notes[botId] = (state.notes[botId] ?? []).filter((n) => !move.includes(n));
			state.sharedMemory.notes.push(...move.map((n) => ({ ...n, shared: true })));
			return { shared: move.length, keptPrivate: keep.length };
		},
		getSharedMemory: () => state.sharedMemory,
		listOpenWork: ({ botId }) => ({ items: state.openWork[bot(botId).id] ?? [] }),
		addOpenWork: ({ botId, text }) => {
			const item = { id: newId("ow"), text, done: false, createdAt: now() };
			(state.openWork[botId] ??= []).push(item);
			return item;
		},
		updateOpenWork: ({ botId, id, ...patch }) =>
			Object.assign(find(state.openWork[botId] ?? [], id, "open work item"), defined(patch)),
		deleteOpenWork: ({ botId, id }) => {
			state.openWork[botId] = (state.openWork[botId] ?? []).filter((item) => item.id !== id);
			return { ok: true };
		},

		// The computer
		getComputer: () => state.computer,
		getScreen: ({ botId, mode }) => ({
			url: `/__fake/screen?bot=${encodeURIComponent(botId)}&mode=${mode}`,
			expiresAt: now() + 60_000,
		}),
		setControl: ({ botId, take }) => {
			const screens = state.computer.screens.filter((s) => s.botId !== botId);
			state.computer.screens = [...screens, { botId, controller: take ? "user" : "bot" }];
			hub.emit({ kind: "computer", state: state.computer });
			return state.computer;
		},
		runMaintenance: ({ action }) => {
			state.computer.status = "maintenance";
			state.computer.job = { action, progress: 0 };
			hub.emit({ kind: "computer", state: state.computer });
			clock.setTimeout(() => {
				state.computer.job = undefined;
				state.computer.status = action === "stop" ? "off" : "awake";
				if (action !== "stop") state.computer.lastSavedAt = now();
				hub.emit({ kind: "computer", state: state.computer });
			}, 2_000);
			return state.computer;
		},
		getSetupScript: () => ({ script: state.setupScript }),
		putSetupScript: ({ script }) => {
			state.setupScript = script;
			return { script };
		},
		protectedInput: () => ({ ok: true }),
		startTeaching: ({ botId }) => ({ sessionId: `${bot(botId).id}-teach-${++counter}` }),
		stopTeaching: () => ({
			name: "export-weekly-list",
			description: "Export this week's list from the CRM to the shared folder",
			content:
				"1. Open the CRM and sign in with the saved login.\n2. Filter contacts by this week.\n3. Export as CSV.\n4. Save it to shared/exports/.",
		}),

		// Connectors
		listCatalog: ({ q, category }) => {
			const needle = q?.toLowerCase();
			return {
				entries: state.catalog.filter(
					(e) =>
						(category === undefined || e.category === category) &&
						(!needle || `${e.name} ${e.maker} ${e.description}`.toLowerCase().includes(needle)),
				),
			};
		},
		getCatalogEntry: ({ appId }) => find(state.catalog, appId, "app"),
		listAppEvents: ({ appId }) => ({ events: APP_EVENTS[find(state.catalog, appId, "app").id] ?? [] }),
		connectApp: ({ appId, skills }) => {
			const entry = find(state.catalog, appId, "app");
			entry.connection = { status: "connected", connectedAt: now() };
			if (skills)
				for (const skill of entry.skills)
					if (!state.skills.some((s) => s.appId === appId && s.name === skill.name))
						state.skills.push({
							id: newId("sk"),
							name: skill.name,
							description: skill.description,
							content: skill.description,
							scope: "app",
							appId,
							updatedAt: now(),
						});
			return { entry };
		},
		disconnectApp: ({ appId }) => {
			find(state.catalog, appId, "app").connection = undefined;
			return { ok: true };
		},
		updateConnection: ({ appId, ...patch }) => Object.assign(find(state.catalog, appId, "app"), defined(patch)),
		addCustomServer: ({ name, url }) => {
			const entry = {
				id: slug(name, (c) => state.catalog.some((e) => e.id === c)),
				name,
				maker: safeHost(url) ?? "Custom",
				category: "developer" as const,
				icon: "custom",
				description: url,
				auth: "oauth" as const,
				skills: [],
				permissions: { reads: "auto" as const, writes: "approval" as const, tools: {} },
			};
			state.catalog.push(entry);
			return entry;
		},

		// Skills
		listSkills: ({ scope, botId, q }) => {
			const needle = q?.toLowerCase();
			return {
				skills: state.skills.filter(
					(s) =>
						(scope === undefined || s.scope === scope) &&
						(botId === undefined || s.botId === undefined || s.botId === botId) &&
						(!needle || `${s.name} ${s.description}`.toLowerCase().includes(needle)),
				),
			};
		},
		createSkill: ({ botId, ...fields }) => {
			const skill: Skill = { id: newId("sk"), ...fields, scope: botId ? "bot" : "user", botId, updatedAt: now() };
			state.skills.push(skill);
			return skill;
		},
		updateSkill: ({ id, ...patch }) =>
			Object.assign(find(state.skills, id, "skill"), defined(patch), { updatedAt: now() }),
		deleteSkill: ({ id }) => {
			state.skills = state.skills.filter((s) => s.id !== id);
			return { ok: true };
		},
		shareSkill: ({ id }) =>
			Object.assign(find(state.skills, id, "skill"), { scope: "user" as const, botId: undefined }),
		previewGitHubSkills: ({ url }) => {
			if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url))
				throw new FakeHttpError(400, "not_github", "paste a GitHub repository URL");
			if (url.endsWith("/empty")) throw new FakeHttpError(404, "no_skills", "that repository has no skills");
			return {
				skills: [
					{
						name: "release-notes",
						description: "Write release notes from merged PRs",
						content: "Group merged PRs by area and write one line each.",
					},
				],
			};
		},
		addGitHubSkills: ({ names }) => {
			const added = names.map((name): Skill => ({
				id: newId("sk"),
				name,
				description: "Write release notes from merged PRs",
				content: "Group merged PRs by area and write one line each.",
				scope: "user",
				updatedAt: now(),
			}));
			state.skills.push(...added);
			return { skills: added };
		},

		// Routines, runs, usage
		listRoutines: ({ botId }) => ({ routines: state.routines.filter((r) => botId === undefined || r.botId === botId) }),
		getRoutine: ({ id }) => find(state.routines, id, "routine"),
		createRoutine: (fields) => {
			bot(fields.botId);
			const routine = { id: newId("rt"), ...fields };
			state.routines.push(routine);
			return routine;
		},
		updateRoutine: ({ id, ...patch }) => Object.assign(find(state.routines, id, "routine"), defined(patch)),
		deleteRoutine: ({ id }) => {
			state.routines = state.routines.filter((r) => r.id !== id);
			return { ok: true };
		},
		testRoutine: ({ id }) => {
			const routine = find(state.routines, id, "routine");
			return startRun(routine.botId, routine.name, routine.id);
		},
		mintWebhook: ({ id }) => {
			const routine = find(state.routines, id, "routine");
			const hookId = newId("wh");
			const trigger = { kind: "webhook" as const, id: hookId };
			routine.triggers.push(trigger);
			return { trigger, url: `https://bots.knightcode.dev/hooks/${hookId}/${newId("secret")}` };
		},
		estimateWatch: ({ trigger }) => {
			if (trigger.kind !== "watch" || trigger.target === "connector") return { computerHoursPerMonth: 0 };
			// Checks that need the computer run at most hourly while it sleeps; each wakes it for one 5-minute block.
			const checksPerMonth = (30 * 24 * 60) / Math.max(60, trigger.everyMinutes);
			return { computerHoursPerMonth: Math.round(((checksPerMonth * 5) / 60) * 10) / 10 };
		},
		listRuns: ({ botId, routineId, status, from, to }) => ({
			runs: state.runs.filter(
				(r) =>
					(botId === undefined || r.botId === botId) &&
					(routineId === undefined || r.routineId === routineId) &&
					(status === undefined || r.status === status) &&
					(from === undefined || r.startedAt >= from) &&
					(to === undefined || r.startedAt <= to),
			),
		}),
		stopRun: ({ id }) => Object.assign(find(state.runs, id, "run"), { status: "stopped" as const, endedAt: now() }),
		listUsage: () => ({ rows: state.usage }),

		// Pages
		listPages: ({ q }) => ({
			pages: state.pages
				.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()))
				.map(({ id, title, ownerBotId, pinned, updatedAt }) => ({ id, title, ownerBotId, pinned, updatedAt })),
		}),
		getPage: ({ id }) => find(state.pages, id, "page"),
		updatePage: ({ id, baseVersion, ...patch }) => {
			const page = find(state.pages, id, "page");
			if (page.version !== baseVersion)
				throw new FakeHttpError(409, "conflict", "the page changed since you opened it");
			return savePage(page, defined(patch));
		},
		getPageVersion: ({ id, version }) => pageVersion(id, version),
		restorePageVersion: ({ id, version }) => {
			const { title, blocks } = pageVersion(id, version);
			return savePage(find(state.pages, id, "page"), { title, blocks: structuredClone(blocks) });
		},
		listPageVersions: ({ id }) => {
			const page = find(state.pages, id, "page");
			return {
				versions: Array.from({ length: page.version }, (_, i) => ({
					version: page.version - i,
					updatedAt: page.updatedAt - i * 3_600_000,
					author: i === 0 ? bot(page.ownerBotId).name : "You",
				})),
			};
		},
		pressPageButton: ({ id, blockId }) => {
			const page = find(state.pages, id, "page");
			const block = page.blocks.find((b) => b.id === blockId);
			if (block?.type !== "button") throw new FakeHttpError(404, "not_found", `no button ${blockId}`);
			if (block.action.kind === "routine") return { runId: testRoutineId(block.action.routineId) };
			const approval = {
				id: newId("appr"),
				botId: page.ownerBotId,
				digest: `sha256:${newId("d")}`,
				action: { tool: `${block.action.appId}.${block.action.tool}`, title: block.label },
				expiresAt: now() + 3_600_000,
				state: "pending" as const,
			};
			state.approvals.push(approval);
			return { approval };
		},
		exportPage: ({ id }) => ({ fileId: `${find(state.pages, id, "page").id}-export-${++counter}` }),

		// Inbox and tasks
		listInbox: () => ({ items: state.inbox, tasks: state.tasks }),
		updateInboxItem: ({ id, ...patch }) => {
			const item = Object.assign(find(state.inbox, id, "inbox item"), defined(patch));
			hub.emit({ kind: "inbox", item });
			return item;
		},
		createTask: (fields) => {
			const task = { id: newId("task"), ...fields, status: "open" as const, source: "user" as const, createdAt: now() };
			state.tasks.push(task);
			return task;
		},
		updateTask: ({ id, ...patch }) => Object.assign(find(state.tasks, id, "task"), defined(patch)),

		// Group chats
		createGroup: ({ name, memberIds, leadId }) => {
			for (const id of memberIds) bot(id);
			if (!memberIds.includes(leadId)) throw new FakeHttpError(400, "invalid", "the lead must be a member");
			const group = {
				id: slug(name, (c) => state.groups.some((g) => g.id === c)),
				name,
				memberIds,
				leadId,
				turnBudget: 12,
				pinned: false,
				unread: 0,
				needsYou: false,
				createdAt: now(),
			};
			state.groups.push(group);
			hub.emit({ kind: "group", group });
			return group;
		},
		getGroup: ({ groupId }) => find(state.groups, groupId, "group"),
		updateGroup: ({ groupId, ...patch }) => {
			const group = Object.assign(find(state.groups, groupId, "group"), defined(patch));
			hub.emit({ kind: "group", group });
			return group;
		},
		deleteGroup: ({ groupId }) => {
			state.groups = state.groups.filter((g) => g.id !== groupId);
			return { ok: true };
		},

		// Settings
		getApprovalSettings: () => state.approvalSettings,
		updateApprovalSettings: (patch) => Object.assign(state.approvalSettings, defined(patch)),
		listVault: () => ({ items: state.vault }),
		putVault: ({ value: _value, ...meta }) => {
			// The value is discarded here; the real backend seals it and never returns it.
			const item = { id: newId("v"), ...meta, createdAt: now() };
			state.vault.push(item);
			return item;
		},
		deleteVault: ({ id }) => {
			state.vault = state.vault.filter((v) => v.id !== id);
			return { ok: true };
		},
		getOnePassword: () => state.onePassword,
		connectOnePassword: () => {
			state.onePassword = { connected: true, account: "raghav@example.com" };
			return { url: "/__fake/1password" };
		},
		disconnectOnePassword: () => {
			state.onePassword = { connected: false };
			return { ok: true };
		},
		getPayments: () => state.payments,
		linkWallet: () => {
			state.payments.linked = true;
			return { url: "/__fake/link-wallet" };
		},
		setSpendLimits: ({ limits }) => Object.assign(state.payments, { limits }),
		getFinance: () => state.finance,
		linkBank: () => ({ linkToken: newId("link") }),
		completeBankLink: () => {
			state.finance.accounts.push({
				id: newId("acc"),
				name: "Savings",
				type: "bank",
				mask: "0042",
				balance: 1800,
				currency: "USD",
			});
			return state.finance;
		},
		unlinkBank: ({ id }) => {
			state.finance.accounts = state.finance.accounts.filter((a) => a.id !== id);
			return { ok: true };
		},
		getHomeRouting: () => state.homeRouting,
		updateHomeRouting: (patch) => Object.assign(state.homeRouting, defined(patch)),
		getTailscale: () => state.tailscale,
		joinTailscale: ({ exitNode }) => Object.assign(state.tailscale, { joined: true, hasKey: true, exitNode }),
		leaveTailscale: () => Object.assign(state.tailscale, { joined: false, exitNode: undefined }),

		// Channels
		getChannels: () => state.channels,
		createTelegramCode: ({ botId }) => ({
			code: `KC-${bot(botId).id.slice(0, 3).toUpperCase()}-${String(4821 + counter++).padStart(4, "0")}`,
			expiresAt: now() + 10 * 60_000,
		}),
		slackInstall: () => ({ url: "/__fake/slack-install" }),
		linkSlackDms: ({ botId }) => {
			const link = {
				id: newId("ch"),
				channel: "slack" as const,
				botId: bot(botId).id,
				externalId: "slack:U123",
				label: "Slack direct messages",
				createdAt: now(),
			};
			state.channels.links.push(link);
			return link;
		},
		updateChannelLink: ({ id, ...patch }) =>
			Object.assign(find(state.channels.links, id, "channel link"), defined(patch)),
		deleteChannelLink: ({ id }) => {
			state.channels.links = state.channels.links.filter((l) => l.id !== id);
			return { ok: true };
		},

		// Billing
		getBilling: () => state.billing,
		subscribe: () => ({ url: "/__fake/checkout?plan=monthly" }),
		cancelSubscription: () => Object.assign(state.billing, { renewsAt: undefined }),
		topUp: ({ amount }) => {
			const fee = Math.round((amount * FEE_RATE + FEE_FIXED) * 100) / 100;
			const credited = Math.round(((amount - fee) / CREDIT_MARKUP) * 100) / 100;
			state.billing.receipts.unshift({ id: newId("rc"), at: now(), amount, fee, credited });
			state.billing.credits = Math.round((state.billing.credits + credited) * 100) / 100;
			return { url: `/__fake/checkout?amount=${amount}` };
		},
		setSpendingLimit: ({ limit }) => Object.assign(state.billing, { spendingLimit: limit }),
		setAutoTopUp: (autoTopUp) => Object.assign(state.billing, { autoTopUp }),
	};

	/** Moves an approval out of pending: the card, the inbox item and every client hear about it. */
	function settleApproval(approval: Approval, outcome: "allowed" | "denied" | "expired"): void {
		approval.state = outcome;
		hub.patchCards(
			(e) => e.kind === "card" && e.card.type === "approval" && e.card.approval.id === approval.id,
			(index) => [["s", ["entries", index, "card", "approval", "state"], outcome]],
		);
		settleInbox((item) => item.approvalId === approval.id);
		hub.emit({ kind: "approval", approval });
	}

	/** Expires every pending approval whose time is up. Checked whenever approvals are read or answered. */
	function expireDue(): void {
		for (const approval of state.approvals)
			if (approval.state === "pending" && now() > approval.expiresAt) settleApproval(approval, "expired");
	}

	function history(key: ThreadKey, before: string | undefined, limit: number | undefined): ConversationView {
		const view = threadView(key);
		const end = before ? view.entries.findIndex((e) => e.id === before) : view.entries.length;
		const stop = end < 0 ? view.entries.length : end;
		const start = Math.max(0, stop - (limit ?? 50));
		return { entries: view.entries.slice(start, stop), running: view.running, hasEarlier: start > 0 };
	}

	function react(key: ThreadKey, entryId: string, emoji: string): { ok: true } {
		const index = threadView(key).entries.findIndex((e) => e.id === entryId);
		const entry = index < 0 ? undefined : message(threadView(key).entries[index]!);
		if (!entry) throw new FakeHttpError(404, "not_found", `no message ${entryId}`);
		const reactions = (entry.reactions ?? []).map((r) => ({ ...r }));
		const existing = reactions.find((r) => r.emoji === emoji);
		if (!existing) reactions.push({ emoji, count: 1, mine: true });
		else if (existing.mine) Object.assign(existing, { count: existing.count - 1, mine: false });
		else Object.assign(existing, { count: existing.count + 1, mine: true });
		hub.commit(key, [["s", ["entries", index, "reactions"], reactions.filter((r) => r.count > 0)]]);
		return { ok: true };
	}

	/** Keeps the version being replaced, then writes the patch as the next version. */
	function savePage(page: Page, patch: Partial<Page>): Page {
		const versions = pageHistory.get(page.id) ?? [];
		versions.push(structuredClone(page));
		pageHistory.set(page.id, versions);
		return Object.assign(page, patch, { version: page.version + 1, updatedAt: now() });
	}

	function pageVersion(id: string, version: string): Page {
		const page = find(state.pages, id, "page");
		const wanted = Number(version);
		const found = page.version === wanted ? page : pageHistory.get(id)?.find((p) => p.version === wanted);
		if (!found) throw new FakeHttpError(404, "not_found", `no version ${version} of ${id}`);
		return found;
	}

	function testRoutineId(routineId: string): string {
		const routine = find(state.routines, routineId, "routine");
		return startRun(routine.botId, routine.name, routine.id).id;
	}

	function cardEntry(entryId: string): { suggestionId?: string } | undefined {
		for (const b of state.bots)
			for (const entry of threadView(`bot:${b.id}`).entries)
				if (entry.id === entryId && entry.kind === "card" && entry.card.type === "suggestion")
					return { suggestionId: entry.card.suggestionId };
		return undefined;
	}

	async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);
		const match = matchRoute(request.method, url.pathname);
		if (!match) return Response.json({ error: "not_found" }, { status: 404 });
		const { route, params } = match;
		try {
			const hasBody = route.method !== "GET" && route.method !== "DELETE";
			const body: unknown = hasBody
				? await request.json().catch(() => undefined)
				: queryToRequest(route, url.searchParams);
			if (typeof body !== "object" || body === null || Array.isArray(body))
				throw new FakeHttpError(400, "invalid", "expected a JSON object");
			const input = parse(route.request, { ...body, ...params });
			// The matcher pairs each route with its own handler; TypeScript cannot correlate the two unions.
			const handler = handlers[route.name] as (request: unknown) => unknown;
			const result = await handler(input);
			// Checked as the client will see it: JSON drops undefined fields. A bad response is the fake's bug, not the caller's.
			const json: unknown = JSON.parse(JSON.stringify(result ?? null));
			try {
				return Response.json(parse(route.response, json));
			} catch (error) {
				return Response.json(
					{ error: "fake_bug", message: error instanceof Error ? error.message : "bad response" },
					{ status: 500 },
				);
			}
		} catch (error) {
			if (error instanceof FakeHttpError)
				return Response.json({ error: error.code, message: error.message }, { status: error.status });
			if (error instanceof ProtocolError)
				return Response.json({ error: "invalid", message: error.message }, { status: 400 });
			throw error;
		}
	}

	return {
		seed,
		state,
		clock,
		fetch: fetch as typeof globalThis.fetch,
		connect: () => hub.connect(),
		executed: (approvalId) => executions.get(approvalId) ?? 0,
	};
}

/** The request's fields without the undefined ones, so `Object.assign` never clears a field by accident. */
function defined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

function safeHost(url: string): string | undefined {
	try {
		return new URL(url).host;
	} catch {
		return undefined;
	}
}
