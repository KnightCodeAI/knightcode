// The bot object (spec sections 5, 6 and 12): one per bot, named by the bot's id. It runs the bot's conversation on the
// durable harness over its own SQLite, keeps its alarm armed so work survives eviction and deploys, and serves the
// bot's live view to its owner's sockets. Every RPC and frame is checked against the bot's owner.
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import { decodeFrame, encodeFrame, ProtocolError, type ServerFrame } from "@knightcode/bots-protocol";
import { type Conversation, createRegistry, type Extension, Harness, type Registry, type ToolRegistration, type Wake } from "@knightcode/durable";
import { openDurableObjectSqliteStorage } from "@knightcode/durable/storage/sqlite/cloudflare";
import { DurableObject } from "cloudflare:workers";
import type { Principal } from "../auth/session.ts";
import { verifyTicket } from "../auth/tickets.ts";
import type { Env } from "../env.ts";
import { adapterFor } from "../delivery/queue.ts";
import { type ActionState, createActionsTable, dispatch, getAction } from "./actions.ts";
import { consumeApproval, type ConsumeResult, createApprovalsTable, denyApproval, digestOf, getApproval } from "./approvals.ts";
import { BotMemory } from "../memory/memory.ts";
import { modelHelper } from "../memory/recall.ts";
import { Connection, RemoteExecutionEnv, webSocketTransport } from "@knightcode/env";
import type { ComputerAccess } from "../computer/browser-tools.ts";
import { botUserFor } from "../computer/provider.ts";
import { botExtensions } from "../tools/catalog.ts";
import { HELP_DOCS } from "../tools/help-docs.ts";
import { availableImageModels } from "../tools/image-tool.ts";
import { type BotSettings, SettingsStore } from "../tools/settings-tool.ts";
import { modelsFor } from "./models.ts";
import { createProvenanceTable } from "./provenance.ts";
import { assertOwns, Unauthorized } from "./principal.ts";
import { nextAlarm } from "./scheduler.ts";
import { type Delivery, LiveView } from "./socket.ts";

const context = BACKGROUND_CONTEXT;
/** A recovery wakeup while work runs: an instance lost mid-run is started again within this. */
const HEARTBEAT_MS = 60_000;

/** The model a bot runs on, chosen in its settings; nothing here picks one. */
export type ModelChoice = { provider: string; modelId: string };

/** What each hibernatable socket remembers across hibernation. */
type Attachment = { principal?: Principal; subscribed?: boolean };

export class BotObject extends DurableObject<Env> {
	#harness!: Harness;
	#root: Conversation | undefined;
	#live: Promise<LiveView> | undefined;
	/** Notes, open work, history and recall. */
	readonly memory: BotMemory;
	readonly #settings: SettingsStore;
	readonly #registry: Registry = createRegistry();
	#extensions: { core: Extension; toolSearch: Extension } | undefined;
	/** The computer lease held while this bot works on its computer. */
	#lease: Promise<string> | undefined;
	#computerEnv: RemoteExecutionEnv | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS bot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		createActionsTable(ctx.storage.sql);
		createApprovalsTable(ctx.storage.sql);
		createProvenanceTable(ctx.storage.sql);
		this.#settings = new SettingsStore(ctx.storage.sql);
		this.memory = new BotMemory({
			sql: ctx.storage.sql,
			botId: this.#id,
			conversation: () => this.#conversation(),
			owner: () => this.#owner,
			// The memory helper is the user's pick; until settings carry one it is the bot's own model.
			helper: () => {
				const owner = this.#owner;
				const model = this.#model;
				return owner && model ? modelHelper(modelsFor({ env: this.env, accountId: owner }), model) : undefined;
			},
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
						// Work done: the computer may sleep once nothing else holds it.
						if (!wake.active) void this.#releaseComputer();
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

	get #owner(): string | undefined {
		return this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM bot_meta WHERE key = 'owner'").toArray()[0]
			?.value;
	}

	get #model(): ModelChoice | undefined {
		const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM bot_meta WHERE key = 'model'").toArray()[0];
		return row ? (JSON.parse(row.value) as ModelChoice) : undefined;
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

	// ─── RPC ──────────────────────────────────────────────────────────────────

	/** Makes `principal`'s account the bot's owner and starts its conversation on `model`. Once only. */
	async claim(principal: Principal, model: ModelChoice): Promise<void> {
		const owner = this.#owner;
		if (owner !== undefined && owner !== principal.accountId) throw new Unauthorized();
		if (owner === undefined) {
			this.ctx.storage.sql.exec("INSERT INTO bot_meta (key, value) VALUES ('owner', ?)", principal.accountId);
			this.ctx.storage.sql.exec("INSERT OR REPLACE INTO bot_meta (key, value) VALUES ('model', ?)", JSON.stringify(model));
		}
		const { core, toolSearch } = await this.#installTools();
		this.#root ??= await this.#harness.root(context, { agent: { model, extensions: [core, toolSearch] } });
	}

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
			// The cwd is fixed when the env is made; the bot user is a stable hash of the bot id.
			return new RemoteExecutionEnv({ connection, id: `computer:${this.#owner}`, cwd: `/home/${this.#botUser}` });
		})();
		return this.#computerEnv;
	}

	/** This bot's OS user on the computer, computed once at start. */
	#botUser = "";

	#computerAccess(): ComputerAccess {
		const computer = () => this.#computer();
		return {
			browser: async (request) => {
				await this.#holdComputer();
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

	/**
	 * The owner's change to the bot's settings (from the settings screen, never from chat): it may grant powers, such as
	 * computer access. The tools are rebuilt to match.
	 */
	async updateSettings(principal: Principal, patch: Partial<BotSettings>): Promise<BotSettings> {
		this.#check(principal, this.#id);
		const current = this.#settings.read();
		const next = { ...current, ...patch };
		if (patch.instructions !== undefined && patch.instructions !== current.instructions)
			next.instructionsVersion = current.instructionsVersion + 1;
		this.#settings.write(next);
		await this.#installTools();
		return next;
	}

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
			settingsChanged: async () => void (await this.#installTools()),
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

	async submit(principal: Principal, text: string, requestId: string): Promise<void> {
		this.#check(principal, this.#id);
		const root = await this.#conversation();
		// Armed before the calls that can start work: `onWake` runs after their commits.
		await this.#arm({ ...this.#harness.wake(), active: true });
		// Recall lands just ahead of the input; a failure there never blocks the message.
		await this.memory.recall(text, requestId).catch((error: unknown) => console.error("recall", error));
		await root.submit({ type: "input", content: text, requestId }, context);
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
	 * The owner's answer to an approval card. Allowing consumes the approval for the exact recorded action, once however
	 * many devices answer, and only then delivers it: the action runs as its own step, not inside the conversation.
	 */
	async answerApproval(principal: Principal, approvalId: string, decision: "allow" | "deny"): Promise<ConsumeResult> {
		this.#check(principal, this.#id);
		const sql = this.ctx.storage.sql;
		const approval = getApproval(sql, approvalId);
		const record = approval && getAction(sql, approval.actionId);
		if (!approval || !record) return "revoked";
		if (decision === "deny") {
			denyApproval(sql, approvalId);
			return "revoked";
		}
		const result = consumeApproval(sql, approvalId, await digestOf(record.intent), this.#policyVersion);
		if (result === "ok") await this.deliverAction(record.id);
		return result;
	}

	/** Delivers one recorded action through its adapter; the queue consumer calls this too. */
	async deliverAction(actionId: string): Promise<ActionState> {
		const record = getAction(this.ctx.storage.sql, actionId);
		if (!record) return "failed";
		const adapter = adapterFor(record.intent.tool);
		if (!adapter) return record.state;
		return dispatch(this.ctx.storage.sql, record, adapter);
	}

	/** Bumped whenever the bot's approval settings change, revoking approvals granted under the old ones. */
	get #policyVersion(): number {
		const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM bot_meta WHERE key = 'policy_version'").toArray()[0];
		return row ? Number(row.value) : 1;
	}

	override async alarm(): Promise<void> {
		await this.#arm({ ...this.#harness.wake(), active: true });
		this.#harness.resume(); // due sleeps and work a lost instance left
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
		// The first frame must be a ticket for this bot's owner; anything else closes the socket.
		if (!attachment.principal) {
			const principal = frame.type === "auth" ? await verifyTicket(this.env, frame.ticket, "socket") : undefined;
			try {
				this.#check(principal, this.#id);
			} catch {
				send({ type: "error", code: "unauthorized", message: "unauthorized" });
				socket.close(4401, "unauthorized");
				return;
			}
			socket.serializeAttachment({ principal } satisfies Attachment);
			send({ type: "ready", accountId: principal!.accountId });
			return;
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
			const live = new LiveView();
			const watch = await (await this.#conversation()).watch(context);
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
