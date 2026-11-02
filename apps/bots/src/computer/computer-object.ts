// The computer object (spec sections 7 and 16): one per user, named by the account id, shared by all of that user's
// bots. It starts the computer lazily when a bot needs it or the user opens a screen, holds a lease per bot run, user
// control and open viewer, and sleeps after 10 minutes with none of them (one idle timer for the whole computer). It
// reserves computer time in 5-minute blocks; a block it cannot reserve stops the computer, and chat keeps working.
// Every save goes through the save coordinator; the workspace is sealed by the user object with the user's data key.
import type { Transport } from "@knightcode/env";
import { DurableObject } from "cloudflare:workers";
import type { Principal } from "../auth/session.ts";
import { randomToken } from "../auth/util.ts";
import type { Env } from "../env.ts";
import type { Reservation } from "../user/balance.ts";
import {
	type BrowserRequest,
	type BrowserResult,
	type DesktopRequest,
	type DesktopResult,
	loginField,
	originMatches,
} from "./browser-tools.ts";
import { CloudflareComputerProvider } from "./cloudflare.ts";
import { type MaintenanceKind, runMaintenance } from "./maintenance.ts";
import { botUserFor, type CapabilityUrl, type ComputerProvider, FakeComputerProvider } from "./provider.ts";
import { type Lease, SaveCoordinator } from "./save-coordinator.ts";
import { issueScreenToken, type ScreenGrant, type ScreenMode, verifyScreenToken, ViewOnlyFilter } from "./screens.ts";

export const IDLE_MS = 10 * 60_000;
export const BLOCK_MS = 5 * 60_000;
/** A lease not renewed for this long is dropped (a run that died without releasing). */
export const LEASE_TTL_MS = 15 * 60_000;

export type LeaseKind = "run" | "control" | "viewer";
export type ComputerState = "stopped" | "running" | "maintenance";

let clock: () => number = () => Date.now();
/** Tests only: the computer's clock (`undefined` restores the real one). */
export function setComputerClock(next: (() => number) | undefined): void {
	clock = next ?? (() => Date.now());
}

/** The fake computers, per account, when BOTS_COMPUTER_PROVIDER is "fake" (the Workers test pool runs no containers). */
export const fakeComputers = new Map<string, FakeComputerProvider>();

export class ComputerObject extends DurableObject<Env> {
	readonly #sql: SqlStorage;
	readonly #provider: ComputerProvider;
	readonly #coordinator: SaveCoordinator;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql = ctx.storage.sql;
		this.#sql.exec("CREATE TABLE IF NOT EXISTS computer_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		this.#sql.exec(
			"CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL)",
		);
		this.#sql.exec("CREATE TABLE IF NOT EXISTS screens (nonce TEXT PRIMARY KEY, bot_id TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)");
		this.#provider =
			env.BOTS_COMPUTER_PROVIDER === "fake"
				? this.#fake()
				: new CloudflareComputerProvider(ctx.container!, {
						bridgeToken: this.#bridgeToken(),
						screenUrl: (botId, mode) => this.#issueScreen(botId, mode),
					});
		this.#coordinator = new SaveCoordinator(this.#sql, (lease) => this.#upload(lease), () => clock());
	}

	/** The account's fake computer; its screen URLs come from this object, as the real provider's do. */
	#fake(): FakeComputerProvider {
		const fake = fakeComputers.get(this.#account) ?? new FakeComputerProvider();
		fakeComputers.set(this.#account, fake);
		fake.screens = (_id, botId, mode) => this.#issueScreen(botId, mode);
		return fake;
	}

	get #account(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	#get(key: string): string | undefined {
		return this.#sql.exec<{ value: string }>("SELECT value FROM computer_meta WHERE key = ?", key).toArray()[0]?.value;
	}

	#set(key: string, value: string | undefined): void {
		if (value === undefined) this.#sql.exec("DELETE FROM computer_meta WHERE key = ?", key);
		else this.#sql.exec("INSERT OR REPLACE INTO computer_meta (key, value) VALUES (?, ?)", key, value);
	}

	#bridgeToken(): string {
		const existing = this.#get("bridge_token");
		if (existing) return existing;
		const token = randomToken(24);
		this.#set("bridge_token", token);
		return token;
	}

	get #state(): ComputerState {
		return (this.#get("state") as ComputerState | undefined) ?? "stopped";
	}

	#user() {
		return this.env.USER.get(this.env.USER.idFromName(this.#account));
	}

	#leases(): { id: string; bot_id: string; kind: LeaseKind; expires_at: number }[] {
		return this.#sql
			.exec<{ id: string; bot_id: string; kind: LeaseKind; expires_at: number }>("SELECT * FROM leases")
			.toArray();
	}

	/** What the user and the bots see of the computer. */
	status(): { state: ComputerState; stoppedReason?: string; leases: number; savedGeneration?: number; step?: string } {
		return {
			state: this.#state,
			...(this.#get("stopped_reason") ? { stoppedReason: this.#get("stopped_reason") } : {}),
			leases: this.#leases().length,
			...(this.#coordinator.latestCompleted() ? { savedGeneration: this.#coordinator.latestCompleted()!.generation } : {}),
			...(this.#get("step") ? { step: this.#get("step") } : {}),
		};
	}

	// ─── Leases and lifecycle ─────────────────────────────────────────────────

	/**
	 * Holds the computer for a bot run, user control or an open viewer, starting it first when it sleeps. Refused while
	 * maintenance runs, or when the next block of computer time cannot be reserved (the spending limit).
	 */
	async acquire(botId: string, kind: LeaseKind): Promise<{ leaseId: string } | { refused: "spending_limit" | "maintenance" }> {
		if (this.#state === "maintenance") return { refused: "maintenance" };
		if (this.#state !== "running") {
			if (!(await this.#reserveBlock())) {
				this.#set("stopped_reason", "spending_limit");
				return { refused: "spending_limit" };
			}
			await this.#start();
		}
		const leaseId = `lease_${crypto.randomUUID()}`;
		this.#sql.exec(
			"INSERT INTO leases (id, bot_id, kind, expires_at) VALUES (?, ?, ?, ?)",
			leaseId,
			botId,
			kind,
			clock() + LEASE_TTL_MS,
		);
		this.#set("last_active", String(clock()));
		await this.#arm();
		return { leaseId };
	}

	async heartbeat(leaseId: string): Promise<boolean> {
		const found = this.#sql.exec("UPDATE leases SET expires_at = ? WHERE id = ? RETURNING id", clock() + LEASE_TTL_MS, leaseId).toArray();
		this.#set("last_active", String(clock()));
		return found.length > 0;
	}

	async release(leaseId: string): Promise<void> {
		this.#sql.exec("DELETE FROM leases WHERE id = ?", leaseId);
		this.#set("last_active", String(clock()));
		await this.#arm();
	}

	async #reserveBlock(): Promise<boolean> {
		const reservation = await this.#user().reserve("computer", 1);
		if (reservation === "insufficient") return false;
		this.#set("block", JSON.stringify({ id: (reservation as Reservation).id, endsAt: clock() + BLOCK_MS }));
		return true;
	}

	async #settleBlock(): Promise<void> {
		const block = this.#get("block");
		if (!block) return;
		await this.#user().settle((JSON.parse(block) as { id: string }).id, 1);
		this.#set("block", undefined);
	}

	/** Starts from the newest completed save: its snapshot when it matches, else its archive, else a fresh computer. */
	async #start(): Promise<void> {
		const plan = this.#coordinator.restorePlan();
		if (plan.kind === "snapshot") {
			try {
				await this.#provider.restoreSnapshot(this.#account, plan.handle);
				this.#set("state", "running");
				this.#set("stopped_reason", undefined);
				return;
			} catch {
				// An expired or broken snapshot: the archive of the same generation is the truth.
			}
		}
		await this.#provider.provision(this.#account);
		const generation = plan.kind === "snapshot" ? plan.handle.generation : plan.kind === "archive" ? plan.generation : undefined;
		if (generation !== undefined) {
			const stream = await this.#user().openWorkspace(generation);
			await this.#provider.importWorkspace(this.#account, readChunks(stream));
		}
		const script = this.#get("setup_script");
		if (script && this.#provider.runSetup) {
			const result = await this.#provider.runSetup(this.#account, script);
			this.#set("setup_result", JSON.stringify({ code: result.code, output: result.output.slice(-4_000), at: clock() }));
		}
		this.#set("state", "running");
		this.#set("stopped_reason", undefined);
	}

	/** Saves (when nothing holds the computer, or before sleep) through the coordinator. */
	async #save(job: string): Promise<void> {
		const lease = this.#coordinator.acquire(job);
		await this.#coordinator.save(lease);
	}

	async #upload(lease: Lease): Promise<void> {
		const stream = toStream(this.#provider.exportWorkspace(this.#account));
		await this.#user().saveWorkspace(lease.generation, stream);
		// The fast path for the next wake; R2 stays the source of truth.
		try {
			this.#coordinator.recordSnapshot(await this.#provider.snapshot(this.#account, lease.generation));
		} catch {
			// No snapshot: the next wake restores the archive.
		}
	}

	/** Saves, then stops the computer; open blocks are settled and leases dropped. */
	async #sleep(reason: "idle" | "spending_limit"): Promise<void> {
		try {
			await this.#save(`sleep:${reason}`);
		} catch (error) {
			console.error("computer save before sleep", error);
		}
		await this.#provider.stop(this.#account);
		await this.#settleBlock();
		this.#sql.exec("DELETE FROM leases");
		this.#set("state", "stopped");
		this.#set("stopped_reason", reason);
		for (const nonce of this.#sql.exec<{ nonce: string }>("SELECT nonce FROM screens WHERE revoked = 0").toArray())
			this.#sql.exec("UPDATE screens SET revoked = 1 WHERE nonce = ?", nonce.nonce);
	}

	async #arm(): Promise<void> {
		if (this.#state !== "running") return this.ctx.storage.deleteAlarm();
		const leases = this.#leases();
		const block = this.#get("block");
		const times = [
			...(block ? [(JSON.parse(block) as { endsAt: number }).endsAt] : []),
			...(leases.length === 0 ? [Number(this.#get("last_active") ?? clock()) + IDLE_MS] : []),
			...leases.map((lease) => lease.expires_at),
		];
		// Due times are on the computer's clock; the alarm is set that far from now.
		await this.ctx.storage.setAlarm(Date.now() + Math.max(0, Math.min(...times) - clock()));
	}

	/** Account deletion: the computer (and its snapshots) destroyed, then its storage and alarm. */
	async purge(): Promise<void> {
		await this.#provider.destroy(this.#account).catch((error: unknown) => console.error("computer destroy", error));
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		this.#deleted = true;
	}
	#deleted = false;

	override async alarm(): Promise<void> {
		if (this.#deleted) return;
		const now = clock();
		this.#sql.exec("DELETE FROM leases WHERE expires_at <= ?", now);
		if (this.#state === "running") {
			const idle = this.#leases().length === 0 && now - Number(this.#get("last_active") ?? now) >= IDLE_MS;
			const block = this.#get("block");
			const blockEnded = !block || (JSON.parse(block) as { endsAt: number }).endsAt <= now;
			if (idle) await this.#sleep("idle");
			else if (blockEnded) {
				await this.#settleBlock();
				if (!(await this.#reserveBlock())) await this.#sleep("spending_limit");
			}
		}
		await this.#arm();
	}

	// ─── Shells ───────────────────────────────────────────────────────────────

	/** A knightcode-env connection running as the bot's own OS user; the bot must hold a lease. */
	async openTransport(botId: string): Promise<Transport> {
		if (this.#state !== "running") throw new Error("the computer is not running");
		if (!this.#leases().some((lease) => lease.bot_id === botId)) throw new Error("the bot does not hold the computer");
		return this.#provider.transport(this.#account, await botUserFor(botId));
	}

	#holds(botId: string): boolean {
		return this.#state === "running" && this.#leases().some((lease) => lease.bot_id === botId);
	}

	/** Drives the bot's Chrome; the bot must hold the computer. */
	async browser(botId: string, request: BrowserRequest): Promise<BrowserResult> {
		if (!this.#holds(botId)) return { error: "The computer is not running for this bot." };
		if (!this.#provider.browser) return { error: "This computer has no browser." };
		if (request.action === "fill") return { error: "Fill logins with fillLogin." };
		return this.#provider.browser(this.#account, await botUserFor(botId), request);
	}

	/**
	 * Fills a login field from the vault, on the server: only into a page on the item's own origin, so a look-alike
	 * site gets nothing. The value is never returned, and the bridge masks the field.
	 */
	async fillLogin(botId: string, ref: string, itemId: string, field: "username" | "password"): Promise<BrowserResult> {
		if (!this.#holds(botId)) return { error: "The computer is not running for this bot." };
		if (!this.#provider.browser) return { error: "This computer has no browser." };
		const botUser = await botUserFor(botId);
		const item = (await this.#user().vaultList()).find((candidate) => candidate.id === itemId && candidate.kind === "login");
		if (!item) return { error: "No login with that id in the vault." };
		const page = await this.#provider.browser(this.#account, botUser, { action: "location" });
		if (!page.url || !originMatches(page.url, item.origin))
			return { error: `This page is not ${item.origin ?? "the login's site"}; the login was not filled.` };
		const value = loginField(await this.#user().vaultReveal(itemId, "fill"), field);
		if (value === undefined) return { error: `The login has no ${field}.` };
		const result = await this.#provider.browser(this.#account, botUser, { action: "fill", ref, secret: value });
		return { ...result, snapshot: `Filled the ${field} from the vault item "${item.name}".` };
	}

	/**
	 * Fills one card field from a payment credential the bot object holds (never stored): masked like a login, into the
	 * bot's checkout page. The value never comes back.
	 */
	async fillCard(botId: string, ref: string, value: string, label: string): Promise<BrowserResult> {
		if (!this.#holds(botId)) return { error: "The computer is not running for this bot." };
		if (!this.#provider.browser) return { error: "This computer has no browser." };
		const result = await this.#provider.browser(this.#account, await botUserFor(botId), { action: "fill", ref, secret: value });
		if (result.error) return { error: result.error };
		return { ...(result.url ? { url: result.url } : {}), snapshot: `Filled the ${label}.` };
	}

	/** The bot's desktop; a screenshot identical to the bot's previous one comes back as `unchanged`. */
	async desktop(botId: string, request: DesktopRequest): Promise<DesktopResult> {
		if (!this.#holds(botId)) return { error: "The computer is not running for this bot." };
		if (!this.#provider.desktop) return { error: "This computer has no desktop." };
		const result = await this.#provider.desktop(this.#account, await botUserFor(botId), request);
		if (!result.image) return result;
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.image.data));
		const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
		const key = `screenshot:${botId}`;
		if (this.#get(key) === hash) return { unchanged: true };
		this.#set(key, hash);
		return result;
	}

	// ─── Screens ──────────────────────────────────────────────────────────────

	async #issueScreen(botId: string, mode: ScreenMode): Promise<CapabilityUrl> {
		const { token, grant } = await issueScreenToken(this.env.SESSION_SECRET, { accountId: this.#account, botId, mode }, clock());
		this.#sql.exec("INSERT INTO screens (nonce, bot_id) VALUES (?, ?)", grant.nonce, botId);
		const origin = this.env.APP_ORIGIN ?? "https://bots.knightcode.dev";
		return { url: `${origin}/api/computer/screen/${token}`, expiresAt: grant.expiresAt };
	}

	/** A screen URL for the owner: view, or control (exclusive input, used for takeover). */
	async screenUrl(principal: Principal, botId: string, mode: ScreenMode): Promise<CapabilityUrl> {
		if (principal.accountId !== this.#account) throw new Error("unauthorized");
		return this.#provider.screen(this.#account, botId, mode);
	}

	/** The grant a screen token carries, if genuine, unexpired, this account's and not revoked. */
	async checkScreen(token: string): Promise<ScreenGrant | undefined> {
		const grant = await verifyScreenToken(this.env.SESSION_SECRET, token, clock());
		if (!grant || grant.accountId !== this.#account) return undefined;
		const row = this.#sql.exec<{ revoked: number }>("SELECT revoked FROM screens WHERE nonce = ?", grant.nonce).toArray()[0];
		return row && row.revoked === 0 ? grant : undefined;
	}

	/** Revokes every screen URL issued for `botId` (all bots when omitted); open connections close. */
	revokeScreens(botId?: string): void {
		if (botId) this.#sql.exec("UPDATE screens SET revoked = 1 WHERE bot_id = ?", botId);
		else this.#sql.exec("UPDATE screens SET revoked = 1");
		for (const [bot, sockets] of this.#screens)
			if (!botId || bot === botId) for (const socket of sockets) socket.close(4403, "revoked");
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const screen = /^\/api\/computer\/screen\/([^/]+)$/.exec(url.pathname);
		if (screen) return this.#screenSocket(request, screen[1]!);
		// A bot object's shell: only reachable from this Worker's own objects (the Worker never forwards /env).
		const shell = /^\/env\/([^/]+)$/.exec(url.pathname);
		if (shell && this.#provider instanceof CloudflareComputerProvider) {
			const botId = decodeURIComponent(shell[1]!);
			if (!this.#leases().some((lease) => lease.bot_id === botId)) return new Response("no lease", { status: 409 });
			return this.#provider.bridge(`/env?user=${encodeURIComponent(await botUserFor(botId))}`, { headers: { upgrade: "websocket" } });
		}
		return new Response("not found", { status: 404 });
	}

	/** Proxies a screen to the bot's VNC display; a view grant's input is filtered out on the way. */
	async #screenSocket(request: Request, token: string): Promise<Response> {
		const grant = await this.checkScreen(token);
		if (!grant) return new Response("expired", { status: 403 });
		if (!(this.#provider instanceof CloudflareComputerProvider)) return new Response("no screen", { status: 501 });
		const held = await this.acquire(grant.botId, grant.mode === "control" ? "control" : "viewer");
		if ("refused" in held) return new Response(held.refused, { status: 409 });
		const upstream = await this.#provider.bridge(`/vnc?user=${encodeURIComponent(await botUserFor(grant.botId))}`, {
			headers: { upgrade: "websocket" },
		});
		const vnc = upstream.webSocket;
		if (!vnc) {
			await this.release(held.leaseId);
			return new Response("screen unavailable", { status: 502 });
		}
		vnc.accept();
		const { 0: client, 1: server } = new WebSocketPair();
		server.accept();
		const filter = grant.mode === "view" ? new ViewOnlyFilter() : undefined;
		const open = this.#screens.get(grant.botId) ?? new Set<WebSocket>();
		this.#screens.set(grant.botId, open.add(server));
		vnc.addEventListener("message", (event) => server.send(event.data as ArrayBuffer));
		server.addEventListener("message", (event) => {
			const data = event.data;
			const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer);
			// A view grant's input never reaches the computer.
			if (!filter || filter.allow(bytes)) vnc.send(bytes);
		});
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			open.delete(server);
			vnc.close(1000, "viewer left");
			server.close(1000, "screen closed");
			void this.release(held.leaseId);
		};
		vnc.addEventListener("close", close);
		server.addEventListener("close", close);
		return new Response(null, { status: 101, webSocket: client });
	}

	/** Open screen connections per bot, so revoking closes them. */
	readonly #screens = new Map<string, Set<WebSocket>>();

	// ─── Maintenance and setup ────────────────────────────────────────────────

	/** Stop, Update, Recover or Reset, as one job that holds off new runs and reports its steps. */
	async maintain(principal: Principal, kind: MaintenanceKind): Promise<void> {
		if (principal.accountId !== this.#account) throw new Error("unauthorized");
		const running = this.#state === "running";
		this.#set("state", "maintenance");
		try {
			await runMaintenance(kind, {
				provider: this.#provider,
				id: this.#account,
				running,
				save: () => this.#save(`maintenance:${kind}`),
				restore: async () => {
					this.#set("state", "stopped");
					await this.#start();
				},
				progress: (step) => this.#set("step", step),
			});
		} finally {
			this.#set("step", undefined);
			if (kind === "stop" || this.#state === "maintenance") {
				this.#set("state", kind === "stop" ? "stopped" : running ? "running" : "stopped");
				if (kind === "stop") {
					await this.#settleBlock();
					this.#sql.exec("DELETE FROM leases");
					this.#set("stopped_reason", "stopped");
				}
			}
			await this.#arm();
		}
	}

	/** The owner's setup script, run as root on every fresh start and after Update. */
	setSetupScript(principal: Principal, script: string): void {
		if (principal.accountId !== this.#account) throw new Error("unauthorized");
		this.#set("setup_script", script.slice(0, 100_000) || undefined);
	}
}

async function* readChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		yield value;
	}
}

function toStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
	const iterator = source[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				controller.error(error);
			}
		},
	});
}
