// The bot object (spec sections 5, 6, 12 and 24): one per bot, named by the bot's id. It runs the bot's conversation on
// the durable harness over its own SQLite, keeps its alarm armed so work survives eviction and deploys, and serves the
// bot's live view to its owner's sockets. Every RPC and frame is checked against the bot's owner. Its own tables share
// the database with the harness, so every host write goes through the harness's queue (host-sql.ts).
import { getSupportedThinkingLevels } from "@knightcode/ai/models";
import { decodeFrame, encodeFrame, ProtocolError, type ServerFrame, type Skill, type SkillDraft } from "@knightcode/bots-protocol";
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import {
	AssistantEntry,
	type Conversation,
	configure,
	createRegistry,
	type EntryId,
	type Extension,
	Harness,
	type Registry,
	ToolResultEntry,
	type ToolRegistration,
	UserEntry,
	type Wake,
} from "@knightcode/durable";
import { openDurableObjectSqliteStorage } from "@knightcode/durable/storage/sqlite/cloudflare";
import { Connection, RemoteExecutionEnv, webSocketTransport } from "@knightcode/env";
import { DurableObject } from "cloudflare:workers";
import { type Principal, sessionLive } from "../auth/session.ts";
import { verifyTicket } from "../auth/tickets.ts";
import type { ComputerAccess } from "../computer/browser-tools.ts";
import { botUserFor } from "../computer/provider.ts";
import { adapterFor } from "../delivery/queue.ts";
import type { Env } from "../env.ts";
import { countRun, dream } from "../memory/dream.ts";
import { extractAfterRun } from "../memory/extract.ts";
import { BotMemory } from "../memory/memory.ts";
import { modelHelper } from "../memory/recall.ts";
import { redactSecrets } from "../memory/redact.ts";
import { type TeachEvent, Teaching } from "../skills/teach.ts";
import { botExtensions } from "../tools/catalog.ts";
import { HELP_DOCS } from "../tools/help-docs.ts";
import { availableImageModels } from "../tools/image-tool.ts";
import { type BotSettings, SettingsStore, type UpdateRules } from "../tools/settings-tool.ts";
import { type ActionState, createActionsTable, deliveriesToResume, dispatch, getAction, markApproved } from "./actions.ts";
import { consumeApproval, type ConsumeResult, createApprovalsTable, denyApproval, digestOf, getApproval } from "./approvals.ts";
import { type HostWrite, queuedWrite } from "./host-sql.ts";
import { modelsFor } from "./models.ts";
import { assertOwns, Unauthorized } from "./principal.ts";
import { createProvenanceTable, isOutside, markOutside, type OutsideSource } from "./provenance.ts";
import { nextAlarm } from "./scheduler.ts";
import { type Delivery, LiveView } from "./socket.ts";

const context = BACKGROUND_CONTEXT;
/** A recovery wakeup while work runs: an instance lost mid-run is started again within this. */
const HEARTBEAT_MS = 60_000;
/** How long a socket trusts its session's last check before asking D1 again (revocation reaches it within this). */
const SESSION_RECHECK_MS = 30_000;
/** Provenance is kept per conversation run; the owner's next new run clears it. */
const RUN_KEY = "current-run";

/** The model a bot runs on, chosen in its settings; nothing here picks one. */
export type ModelChoice = { provider: string; modelId: string };

/** What each hibernatable socket remembers across hibernation. */
type Attachment = { principal?: Principal; subscribed?: boolean; checkedAt?: number };

export class BotObject extends DurableObject<Env> {
	#harness!: Harness;
	#root: Conversation | undefined;
	#live: Promise<LiveView> | undefined;
	/** Notes, open work, history and recall. */
	readonly memory: BotMemory;
	readonly #write: HostWrite;
	readonly #settings: SettingsStore;
	readonly #teaching: Teaching;
	readonly #registry: Registry = createRegistry();
	#extensions: { core: Extension; toolSearch: Extension } | undefined;
	/** The computer lease held while this bot works on its computer. */
	#lease: Promise<string> | undefined;
	#computerEnv: RemoteExecutionEnv | undefined;
	/** One delivery of an action at a time, so a check and a send never overlap another of the same action. */
	readonly #deliveries = new Map<string, Promise<ActionState>>();
	#afterRunning: Promise<void> | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = ctx.storage.sql;
		sql.exec("CREATE TABLE IF NOT EXISTS bot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		createActionsTable(sql);
		createApprovalsTable(sql);
		createProvenanceTable(sql);
		this.#write = queuedWrite(ctx.storage);
		this.#settings = new SettingsStore(sql, this.#write);
		this.#teaching = new Teaching(sql, this.#write);
		this.memory = new BotMemory({
			sql,
			botId: this.#id,
			conversation: () => this.#conversation(),
			owner: () => this.#owner,
			// The memory helper is the user's pick; until settings carry one it is the bot's own model.
			helper: () => this.#helper(),
			write: this.#write,
		});
		void ctx.blockConcurrencyWhile(async () => {
			// A fallback before anything can throw: an object whose open or recovery fails is started again.
			const fallback = Date.now() + HEARTBEAT_MS;
			const current = await ctx.storage.getAlarm();
			if (current === null || current > fallback) await ctx.storage.setAlarm(fallback);
			const storage = await openDurableObjectSqliteStorage(ctx.storage, { prefix: "durable_" });
			this.#harness = await Harness.open(
				storage,
				{
					models: () => modelsFor({ env: this.env, accountId: this.#owner ?? "" }),
					registry: this.#registry,
					// Shell and file tools run on the user's computer, as this bot's own OS user, when it has access.
					env: () => (this.#settings.read().computerAccess ? this.#computerEnvFor() : undefined),
					// A failed alarm write resets the object; it arms again when it next starts.
					onWake: (wake) => {
						void this.#arm(wake).catch(() => ctx.abort("Alarm write failed"));
						if (!wake.active) {
							// Work done: the computer may sleep once nothing else holds it, and memory learns from the run.
							void this.#releaseComputer();
							ctx.waitUntil(this.#afterRun());
						}
					},
				},
				context,
			);
			// The tools are installed before any work resumes, so a resumed run finds them.
			if (this.#owner !== undefined) await this.#installTools();
			// Armed before `resume()` runs anything, as before any call that can start work.
			await this.#arm(this.#harness.wake());
			this.#harness.resume();
			// Sockets that outlived the last instance get the view again (their versions are this instance's no more).
			if (this.#sockets().length > 0) void this.#startLive();
		});
	}

	get #id(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	#meta(key: string): string | undefined {
		return this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM bot_meta WHERE key = ?", key).toArray()[0]?.value;
	}

	#setMeta(key: string, value: string): Promise<void> {
		return this.#write((sql) => void sql.exec("INSERT OR REPLACE INTO bot_meta (key, value) VALUES (?, ?)", key, value));
	}

	get #owner(): string | undefined {
		return this.#meta("owner");
	}

	get #model(): ModelChoice | undefined {
		const value = this.#meta("model");
		return value ? (JSON.parse(value) as ModelChoice) : undefined;
	}

	#check(principal: Principal | undefined, botId: string): void {
		assertOwns({ id: this.#id, owner: this.#owner }, principal, botId);
	}

	async #arm(wake: Wake): Promise<void> {
		const at = nextAlarm({ wake, routineDeadlines: [], now: Date.now(), heartbeatMs: HEARTBEAT_MS });
		if (at === undefined) await this.ctx.storage.deleteAlarm();
		else await this.ctx.storage.setAlarm(at);
	}

	async #conversation(): Promise<Conversation> {
		this.#root ??= await this.#harness.root(context);
		return this.#root;
	}

	#helper() {
		const owner = this.#owner;
		const model = this.#model;
		return owner && model ? modelHelper(modelsFor({ env: this.env, accountId: owner }), model) : undefined;
	}

	// ─── Ownership and settings ───────────────────────────────────────────────

	/** Makes `principal`'s account the bot's owner and starts its conversation on `model`. Once only. */
	async claim(principal: Principal, model: ModelChoice): Promise<void> {
		const owner = this.#owner;
		if (owner !== undefined && owner !== principal.accountId) throw new Unauthorized();
		if (owner === undefined)
			await this.#write((sql) => {
				sql.exec("INSERT INTO bot_meta (key, value) VALUES ('owner', ?)", principal.accountId);
				sql.exec("INSERT OR REPLACE INTO bot_meta (key, value) VALUES ('model', ?)", JSON.stringify(model));
			});
		const { core, toolSearch } = await this.#installTools();
		this.#root ??= await this.#harness.root(context, { agent: { model, extensions: [core, toolSearch] } });
	}

	/**
	 * The owner's change to the bot's settings (from the settings screen, never from chat): it may grant powers, such as
	 * computer access. The tools are rebuilt to match, and a model change reaches the conversation.
	 */
	async updateSettings(principal: Principal, patch: Partial<BotSettings>): Promise<BotSettings> {
		this.#check(principal, this.#id);
		const before = this.#settings.read();
		const next = { ...before, ...patch };
		if (patch.instructions !== undefined && patch.instructions !== before.instructions)
			next.instructionsVersion = before.instructionsVersion + 1;
		await this.#settings.write(next);
		await this.#settingsChanged(next, before);
		return next;
	}

	/** Undoes the newest settings change (from chat or the settings screen). */
	async undoSettings(principal: Principal): Promise<BotSettings | undefined> {
		this.#check(principal, this.#id);
		const before = this.#settings.read();
		const restored = await this.#settings.undo();
		if (restored) await this.#settingsChanged(restored, before);
		return restored;
	}

	/** Applies a settings change: the agent's model and thinking, and the tools (powers on or off). */
	async #settingsChanged(settings: BotSettings, before: BotSettings): Promise<void> {
		const modelChanged = JSON.stringify(settings.model) !== JSON.stringify(before.model) || settings.thinking !== before.thinking;
		if (modelChanged && settings.model) {
			const root = await this.#conversation();
			const model = settings.model;
			await root.commit(
				(tx) =>
					configure(tx, root.id, {
						model,
						...(settings.thinking ? { thinkingLevel: settings.thinking as never } : {}),
					}),
				context,
			);
			await this.#setMeta("model", JSON.stringify(model));
		}
		await this.#installTools();
	}

	/** What chat may change now: nothing but powers going down while outside text is in play; only the user's models. */
	#settingsRules(): UpdateRules {
		const owner = this.#owner;
		return {
			outside: this.#outside(),
			model: (provider, modelId) => {
				const model = owner ? modelsFor({ env: this.env, accountId: owner }).getModel(provider, modelId) : undefined;
				return model ? { thinking: getSupportedThinkingLevels(model) } : undefined;
			},
		};
	}

	// ─── Provenance ───────────────────────────────────────────────────────────

	#outside(): boolean {
		return isOutside(this.ctx.storage.sql, RUN_KEY);
	}

	/** Outside text entered the current run: the mark stays through steers, retries and runs that continue the work. */
	#enterOutside(source: OutsideSource): Promise<void> {
		return this.#write((sql) => markOutside(sql, RUN_KEY, source));
	}

	// ─── The computer ─────────────────────────────────────────────────────────

	#computer() {
		return this.env.COMPUTER.get(this.env.COMPUTER.idFromName(this.#owner!));
	}

	/** Holds the user's computer for this bot, starting it if it sleeps; renewed on every use. */
	async #holdComputer(): Promise<string> {
		const held = this.#lease;
		if (held) {
			const leaseId = await held;
			if (await this.#computer().heartbeat(leaseId)) return leaseId;
		}
		this.#lease = this.#computer()
			.acquire(this.#id, "run")
			.then((result) => {
				if ("leaseId" in result) return result.leaseId;
				throw new Error(
					result.refused === "spending_limit"
						? "The computer is stopped: the spending limit is reached. Chat still works; the owner can raise the limit in Usage & Billing."
						: "The computer is under maintenance; try again shortly.",
				);
			});
		this.#lease.catch(() => (this.#lease = undefined));
		return this.#lease;
	}

	async #releaseComputer(): Promise<void> {
		const held = this.#lease;
		this.#lease = undefined;
		if (!held) return;
		try {
			await this.#computer().release(await held);
		} catch {
			// Never held, or already dropped.
		}
	}

	/** This bot's OS user on the computer, computed when the tools are installed. */
	#botUser = "";

	#computerEnvFor(): RemoteExecutionEnv {
		this.#computerEnv ??= (() => {
			const botId = this.#id;
			const connection = new Connection({
				transport: async () => {
					await this.#holdComputer();
					const response = await this.#computer().fetch(`https://computer/env/${encodeURIComponent(botId)}`, {
						headers: { upgrade: "websocket" },
					});
					const socket = response.webSocket;
					if (!socket) throw new Error(`The computer refused the shell (${response.status}).`);
					socket.accept();
					return webSocketTransport(socket as unknown as Parameters<typeof webSocketTransport>[0]);
				},
			});
			return new RemoteExecutionEnv({ connection, id: `computer:${this.#owner}`, cwd: `/home/${this.#botUser}` });
		})();
		return this.#computerEnv;
	}

	#computerAccess(): ComputerAccess {
		const computer = () => this.#computer();
		return {
			browser: async (request) => {
				await this.#holdComputer();
				// A page the bot reads is outside text.
				if (request.action === "snapshot" || request.action === "navigate") await this.#enterOutside("web");
				return computer().browser(this.#id, request);
			},
			desktop: async (request) => {
				await this.#holdComputer();
				return computer().desktop(this.#id, request);
			},
			fillLogin: async (ref, item, field) => {
				await this.#holdComputer();
				return computer().fillLogin(this.#id, ref, item, field);
			},
		};
	}

	// ─── Teaching by showing ──────────────────────────────────────────────────

	startTeaching(principal: Principal, goal: string): Promise<{ sessionId: string }> {
		this.#check(principal, this.#id);
		return this.#teaching.startTeaching(goal);
	}

	/** One demonstrated step (the client sends the event, the screen's screenshot and the page snapshot). */
	recordTeachStep(principal: Principal, sessionId: string, event: TeachEvent, screenshot?: string, snapshot?: string): Promise<boolean> {
		this.#check(principal, this.#id);
		return this.#teaching.recordStep(sessionId, event, screenshot, snapshot);
	}

	/** Drafts the skill on the bot's own model. */
	async stopTeaching(principal: Principal, sessionId: string): Promise<SkillDraft> {
		this.#check(principal, this.#id);
		const helper = this.#helper();
		if (!helper) throw new Error("The bot has no model to draft with.");
		return this.#teaching.stopTeaching(sessionId, helper);
	}

	/** Saves the draft as this bot's skill (until the user shares it) and deletes the recording. */
	async saveTeachingDraft(principal: Principal, sessionId: string, draft: SkillDraft): Promise<Skill> {
		this.#check(principal, this.#id);
		const user = this.env.USER.get(this.env.USER.idFromName(this.#owner!));
		const skill = await user.skillAdd({ ...draft, scope: "bot", botId: this.#id });
		await this.#teaching.discard(sessionId);
		return skill;
	}

	async discardTeaching(principal: Principal, sessionId: string): Promise<void> {
		this.#check(principal, this.#id);
		await this.#teaching.discard(sessionId);
	}

	// ─── Tools ────────────────────────────────────────────────────────────────

	/** The bot's tools as installed now (its own and tool search). */
	tools(): ToolRegistration[] {
		const extensions = this.#extensions;
		return extensions ? [...(extensions.core.tools ?? []), ...(extensions.toolSearch.tools ?? [])] : [];
	}

	/**
	 * Builds and installs the bot's extensions for its owner. Image generation is offered only when one of the owner's
	 * providers has an image model.
	 */
	async #installTools(): Promise<{ core: Extension; toolSearch: Extension }> {
		const owner = this.#owner!;
		this.#botUser = await botUserFor(this.#id);
		const models = modelsFor({ env: this.env, accountId: owner });
		const user = this.env.USER.get(this.env.USER.idFromName(owner));
		const botId = this.#id;
		const extensions = botExtensions({
			settings: this.#settings,
			memory: this.memory,
			help: HELP_DOCS,
			knowledge: {
				list: () => user.listFiles({ botId, kind: "knowledge" }),
				read: async (name) => {
					const file = (await user.listFiles({ botId, kind: "knowledge" })).find((candidate) => candidate.name === name);
					const found = file && (await user.getFile(file.id));
					return found ? new TextDecoder().decode(found.body) : undefined;
				},
			},
			...(this.#settings.read().computerAccess ? { computer: this.#computerAccess() } : {}),
			settingsChanged: (settings, before) => this.#settingsChanged(settings, before),
			settingsRules: () => this.#settingsRules(),
			provenance: { outside: () => this.#outside(), enter: (source) => this.#enterOutside(source) },
			image: {
				models,
				available: await availableImageModels(models),
				save: ({ name, mime, bytes }) => user.putFile({ name, mime, kind: "bot-output", botId }, bytes),
			},
		});
		this.#registry.install(extensions.core);
		this.#registry.install(extensions.toolSearch);
		this.#extensions = extensions;
		return extensions;
	}

	// ─── Chat ─────────────────────────────────────────────────────────────────

	/** The owner's message. While a run is going it steers that run; otherwise it starts one, clearing the outside mark. */
	async submit(principal: Principal, text: string, requestId: string): Promise<void> {
		this.#check(principal, this.#id);
		const root = await this.#conversation();
		const idle = !this.#harness.wake().active;
		// Armed before the calls that can start work: `onWake` runs after their commits.
		await this.#arm({ ...this.#harness.wake(), active: true });
		// A new run the owner starts is the owner's; a steer stays in the run outside text may have touched.
		if (idle) await this.#write((sql) => void sql.exec("DELETE FROM provenance WHERE run_id = ?", RUN_KEY));
		// Recall lands just ahead of the input; a failure there never blocks the message.
		await this.memory.recall(text, requestId).catch((error: unknown) => console.error("recall", error));
		await root.submit({ type: "input", content: text, requestId, whenBusy: "steer" }, context);
	}

	async stop(principal: Principal): Promise<void> {
		this.#check(principal, this.#id);
		const root = await this.#conversation();
		await this.#arm({ ...this.#harness.wake(), active: true });
		await root.abort(context);
	}

	/** A routine's run (Task 3.4 supplies the prompt); one per routine and firing time however often it is called. */
	async routineFire(routineId: string, firedAt: number): Promise<void> {
		if (this.#owner === undefined) return;
		const root = await this.#conversation();
		await this.#arm({ ...this.#harness.wake(), active: true });
		await root.submit(
			{ type: "input", content: `Run routine ${routineId}.`, requestId: `routine:${routineId}:${firedAt}` },
			context,
		);
	}

	/**
	 * After a run: memory saves what it learned (unless it wrote notes itself), and consolidation runs once a day after
	 * enough runs. Entries already processed are tracked, so each run is handled once even across restarts.
	 */
	#afterRun(): Promise<void> {
		// One pass at a time; the guard is released only after it is stored, even when the pass ends at once.
		if (this.#afterRunning) return this.#afterRunning;
		const pass = this.#learnFromRun().catch((error: unknown) => console.error("after run", error));
		this.#afterRunning = pass;
		void pass.finally(() => {
			if (this.#afterRunning === pass) this.#afterRunning = undefined;
		});
		return pass;
	}

	async #learnFromRun(): Promise<void> {
			const helper = this.#helper();
			if (!helper || this.#owner === undefined) return;
			const root = await this.#conversation();
			const through = Number(this.#meta("extracted_through") ?? -1);
			const page = await root.entries({ minEntryId: (through + 1) as EntryId, order: "ascending" }, 500, undefined, context);
			if (page.items.length === 0) return;
			let wroteNotes = false;
			const lines: string[] = [];
			for (const entry of page.items) {
				const message = entry.model?.[0] as { content?: unknown } | undefined;
				const content = Array.isArray(message?.content) ? (message.content as { type: string; text?: string; name?: string }[]) : [];
				if (AssistantEntry.is(entry) && content.some((block) => block.type === "toolCall" && block.name === "save_note")) wroteNotes = true;
				const text =
					typeof message?.content === "string" ? message.content : content.filter((b) => b.type === "text").map((b) => b.text).join("");
				if (!text) continue;
				const who = UserEntry.is(entry) ? "user" : AssistantEntry.is(entry) ? "assistant" : ToolResultEntry.is(entry) ? "tool" : undefined;
				if (who) lines.push(`${who}: ${redactSecrets(text).slice(0, 4_000)}`);
			}
			await extractAfterRun({ notes: this.memory.notes, helper, transcript: lines.join("\n"), wroteNotes, outside: this.#outside() });
			await this.#setMeta("extracted_through", String(Number(page.items.at(-1)!.id)));
			await countRun(this.#write);
			await dream({ sql: this.ctx.storage.sql, notes: this.memory.notes, helper, write: this.#write }, { minHours: 24, minRuns: 5 });
	}

	// ─── Actions and approvals ────────────────────────────────────────────────

	/**
	 * The owner's answer to an approval card. Allowing consumes the approval for the exact recorded action, once however
	 * many devices answer; the action is then marked approved, published to the delivery queue and delivered. Until it
	 * settles, the queue and this object's alarm keep delivering it.
	 */
	async answerApproval(principal: Principal, approvalId: string, decision: "allow" | "deny"): Promise<ConsumeResult> {
		this.#check(principal, this.#id);
		const sql = this.ctx.storage.sql;
		const approval = getApproval(sql, approvalId);
		const record = approval && getAction(sql, approval.actionId);
		if (!approval || !record) return "revoked";
		if (decision === "deny") {
			await this.#write((db) => denyApproval(db, approvalId));
			return "revoked";
		}
		const digest = await digestOf(record.intent);
		const policyVersion = this.#policyVersion;
		const result = await this.#write((db) => {
			const consumed = consumeApproval(db, approvalId, digest, policyVersion);
			if (consumed === "ok") markApproved(db, record.id);
			return consumed;
		});
		if (result === "ok") {
			await this.env.OUTBOUND.send({ botId: this.#id, actionId: record.id }).catch(() => undefined);
			await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
			await this.deliverAction(record.id).catch(() => undefined);
		}
		return result;
	}

	/** Delivers one recorded action through its adapter, one delivery at a time per action; the queue calls this too. */
	deliverAction(actionId: string): Promise<ActionState> {
		const previous = this.#deliveries.get(actionId) ?? Promise.resolve("pending" as ActionState);
		const next = previous
			.catch(() => "pending" as ActionState)
			.then(() => {
				const record = getAction(this.ctx.storage.sql, actionId);
				if (!record) return "failed" as ActionState;
				const adapter = adapterFor(record.intent.tool);
				if (!adapter) return record.state;
				return dispatch(this.ctx.storage.sql, record, adapter, this.#write);
			});
		this.#deliveries.set(actionId, next);
		void next.finally(() => {
			if (this.#deliveries.get(actionId) === next) this.#deliveries.delete(actionId);
		});
		return next;
	}

	/** Bumped whenever the bot's approval settings change, revoking approvals granted under the old ones. */
	get #policyVersion(): number {
		return Number(this.#meta("policy_version") ?? 1);
	}

	override async alarm(): Promise<void> {
		await this.#arm({ ...this.#harness.wake(), active: true });
		this.#harness.resume(); // due sleeps and work a lost instance left
		// Approved actions not yet settled are delivered again (a neither adapter's unknown outcome never is).
		const pending = deliveriesToResume(this.ctx.storage.sql);
		for (const actionId of pending) await this.deliverAction(actionId).catch(() => undefined);
		if (deliveriesToResume(this.ctx.storage.sql).some((id) => getAction(this.ctx.storage.sql, id)?.state === "pending"))
			await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
	}

	// ─── Sockets ──────────────────────────────────────────────────────────────

	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({} satisfies Attachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const attachment = (socket.deserializeAttachment() ?? {}) as Attachment;
		const send = (frame: ServerFrame) => socket.send(encodeFrame(frame));
		let frame;
		try {
			frame = decodeFrame(typeof message === "string" ? message : new TextDecoder().decode(message));
		} catch (error) {
			send({ type: "error", code: "bad_frame", message: error instanceof ProtocolError ? error.message : "bad frame" });
			return;
		}
		const refuse = () => {
			send({ type: "error", code: "unauthorized", message: "unauthorized" });
			socket.close(4401, "unauthorized");
		};
		// The first frame must be a ticket for this bot's owner, from a live session; anything else closes the socket.
		if (!attachment.principal) {
			const principal = frame.type === "auth" ? await verifyTicket(this.env, frame.ticket, "socket") : undefined;
			try {
				this.#check(principal, this.#id);
			} catch {
				return refuse();
			}
			socket.serializeAttachment({ principal, checkedAt: Date.now() } satisfies Attachment);
			send({ type: "ready", accountId: principal!.accountId });
			return;
		}
		// A revoked session ends its sockets: rechecked at most every 30 seconds.
		if (Date.now() - (attachment.checkedAt ?? 0) > SESSION_RECHECK_MS) {
			const live = attachment.principal.sessionId ? await sessionLive(this.env, attachment.principal.sessionId) : false;
			if (!live) return refuse();
			socket.serializeAttachment({ ...attachment, checkedAt: Date.now() } satisfies Attachment);
		}
		if (!("botId" in frame)) return;
		try {
			this.#check(attachment.principal, frame.botId);
			if (frame.type === "subscribe") {
				socket.serializeAttachment({ ...attachment, subscribed: true } satisfies Attachment);
				const live = await this.#startLive();
				for (const delivery of live.catchUp(frame.since)) send(this.#frame(delivery));
			} else if (frame.type === "unsubscribe") {
				socket.serializeAttachment({ ...attachment, subscribed: false } satisfies Attachment);
			} else if (frame.type === "submit") {
				await this.submit(attachment.principal, frame.text, frame.requestId);
			} else if (frame.type === "stop") {
				await this.stop(attachment.principal);
			}
		} catch (error) {
			const unauthorized = error instanceof Unauthorized;
			send({
				type: "error",
				code: unauthorized ? "unauthorized" : "failed",
				message: unauthorized ? "unauthorized" : "the request failed",
				...("requestId" in frame && typeof frame.requestId === "string" ? { requestId: frame.requestId } : {}),
			});
		}
	}

	override webSocketClose(socket: WebSocket, code: number): void {
		socket.close(code === 1005 ? 1000 : code, "closing");
	}

	#sockets(): WebSocket[] {
		return this.ctx.getWebSockets().filter((socket) => (socket.deserializeAttachment() as Attachment | null)?.subscribed);
	}

	#frame(delivery: Delivery): ServerFrame {
		return { ...delivery, botId: this.#id } as ServerFrame;
	}

	/** Watches the conversation once per instance and sends each change to the subscribed sockets. */
	#startLive(): Promise<LiveView> {
		this.#live ??= (async () => {
			const root = await this.#conversation();
			const live = new LiveView((query, limit, ctx) => root.entries(query, limit, undefined, ctx));
			const watch = await root.watch(context);
			live.update(watch.value);
			watch.start(async (call) => {
				if (call.kind !== "value") return;
				const delivery = live.update(call.value);
				if (!delivery) return;
				const text = encodeFrame(this.#frame(delivery));
				for (const socket of this.#sockets()) socket.send(text);
			});
			return live;
		})();
		return this.#live;
	}
}
