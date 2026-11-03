// The provider layer (spec section 7): everything the computer object needs from whatever runs the container. The
// Cloudflare implementation is in cloudflare.ts; the fake here backs the Workers test pool, which runs no containers.
import type { Transport } from "@knightcode/env";
import type { BrowserRequest, BrowserResult, DesktopRequest, DesktopResult } from "./browser-tools.ts";

/** A short-lived, revocable URL for one bot's screen. */
export interface CapabilityUrl {
	url: string;
	expiresAt: number;
}

/** A container snapshot, tagged with the save generation it was taken after. */
export interface SnapshotHandle {
	id: string;
	generation: number;
	createdAt: number;
}

export interface ComputerProvider {
	provision(id: string): Promise<void>;
	/** True when the computer is still running and answering. */
	reconnect(id: string): Promise<boolean>;
	stop(id: string): Promise<void>;
	destroy(id: string): Promise<void>;
	/** A knightcode-env connection running as `botUser`. */
	transport(id: string, botUser: string): Promise<Transport>;
	screen(id: string, botId: string, mode: "view" | "control"): Promise<CapabilityUrl>;
	/** The workspace (home directories, saves excluded) as a tar stream, after browsers are quiesced. */
	exportWorkspace(id: string): AsyncIterable<Uint8Array>;
	importWorkspace(id: string, data: AsyncIterable<Uint8Array>): Promise<void>;
	snapshot(id: string, generation: number): Promise<SnapshotHandle>;
	restoreSnapshot(id: string, handle: SnapshotHandle): Promise<void>;
	/** Drives `botUser`'s Chrome (absent where there is no browser, as in the fake). */
	browser?(id: string, botUser: string, request: BrowserRequest): Promise<BrowserResult>;
	/** Screenshots and input on `botUser`'s display. */
	desktop?(id: string, botUser: string, request: DesktopRequest): Promise<DesktopResult>;
	/** Runs the owner's setup script as root; resolves with its exit code and the tail of its output. */
	runSetup?(id: string, script: string): Promise<{ code: number; output: string }>;
}

/** The OS user a bot's shell and Chrome run as: stable, distinct per bot, a valid Linux user name. */
export async function botUserFor(botId: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botId)));
	return `bot_${[...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Where a bot user's Chrome profile lives; its home is mode 700, so no other bot user can read it. */
export const chromeProfileDir = (botUser: string) => `/home/${botUser}/.config/chromium`;
export const SHARED_DIR = "/home/shared";

// ─── The fake ────────────────────────────────────────────────────────────────

type FakeFile = { owner: string; mode: number; data: string };

/**
 * A provider that keeps the computer's state in memory and models what the image guarantees: one OS user per bot,
 * homes readable only by their owner, a group-writable shared folder. Its transports are simple shells over that
 * model (`read`/`write` commands), enough to test the object's lifecycle and isolation rules.
 */
export class FakeComputerProvider implements ComputerProvider {
	running = false;
	provisioned = false;
	readonly calls: string[] = [];
	readonly files = new Map<string, FakeFile>();
	readonly users = new Set<string>();
	workspace: Uint8Array = new Uint8Array();
	readonly snapshots: SnapshotHandle[] = [];
	screens: (id: string, botId: string, mode: "view" | "control") => Promise<CapabilityUrl> = async (_id, botId, mode) => ({
		url: `https://fake/${botId}/${mode}`,
		expiresAt: Date.now() + 60_000,
	});

	async provision(id: string) {
		this.calls.push(`provision:${id}`);
		this.provisioned = true;
		this.running = true;
		// A new container: an empty disk until a save is imported.
		this.files.clear();
		this.users.clear();
	}
	async reconnect(id: string) {
		this.calls.push(`reconnect:${id}`);
		return this.running;
	}
	async stop(id: string) {
		this.calls.push(`stop:${id}`);
		this.running = false;
		// The container and its disk are gone; only the save (archive or snapshot) brings them back.
		this.files.clear();
		this.users.clear();
	}
	async destroy(id: string) {
		this.calls.push(`destroy:${id}`);
		this.running = false;
		this.provisioned = false;
	}

	/** Creates `botUser` as the image's bridge does: a 700 home and a Chrome profile in it. */
	addUser(botUser: string) {
		if (this.users.has(botUser)) return;
		this.users.add(botUser);
		this.files.set(`${chromeProfileDir(botUser)}/Default/Cookies`, { owner: botUser, mode: 0o600, data: `cookies of ${botUser}` });
	}

	/** Whether `user` may read `path` under the model: its own home, or the shared folder. */
	canRead(user: string, path: string): boolean {
		const file = this.files.get(path);
		if (!file) return false;
		if (path.startsWith(`${SHARED_DIR}/`)) return true;
		const home = /^\/home\/([^/]+)\//.exec(path)?.[1];
		return home === user && file.owner === user;
	}

	async transport(id: string, botUser: string): Promise<Transport> {
		if (!this.running) throw new Error("the computer is not running");
		this.calls.push(`transport:${id}:${botUser}`);
		this.addUser(botUser);
		const listeners = new Set<(frame: Uint8Array) => void>();
		const closers = new Set<(reason: string) => void>();
		const encoder = new TextEncoder();
		return {
			// One JSON command per frame: {"read": path} or {"write": path, "data": text}.
			send: (frame) => {
				const command = JSON.parse(new TextDecoder().decode(frame)) as { read?: string; write?: string; data?: string };
				let reply: unknown;
				if (command.read !== undefined)
					reply = this.canRead(botUser, command.read)
						? { ok: true, data: this.files.get(command.read)!.data }
						: { ok: false, error: "EACCES: permission denied" };
				else if (command.write !== undefined) {
					const home = /^\/home\/([^/]+)\//.exec(command.write)?.[1];
					if (home !== botUser && !command.write.startsWith(`${SHARED_DIR}/`)) reply = { ok: false, error: "EACCES: permission denied" };
					else {
						this.files.set(command.write, { owner: botUser, mode: 0o644, data: command.data ?? "" });
						reply = { ok: true };
					}
				}
				queueMicrotask(() => {
					for (const listener of listeners) listener(encoder.encode(JSON.stringify(reply)));
				});
			},
			onFrame: (listener) => void listeners.add(listener),
			onClose: (listener) => void closers.add(listener),
			close: () => {
				for (const listener of closers) listener("closed");
			},
		};
	}

	screen(id: string, botId: string, mode: "view" | "control") {
		return this.screens(id, botId, mode);
	}

	/** The disk as a save carries it: every file with its owner and mode. */
	#disk(): string {
		return JSON.stringify([...this.files]);
	}
	#restore(disk: string) {
		this.files.clear();
		this.users.clear();
		for (const [path, file] of JSON.parse(disk) as [string, FakeFile][]) {
			this.files.set(path, file);
			const home = /^\/home\/([^/]+)\//.exec(path)?.[1];
			if (home) this.users.add(home);
		}
	}

	async *exportWorkspace(id: string): AsyncIterable<Uint8Array> {
		this.calls.push(`export:${id}`);
		this.workspace = new TextEncoder().encode(this.#disk());
		yield this.workspace;
	}
	async importWorkspace(id: string, data: AsyncIterable<Uint8Array>) {
		this.calls.push(`import:${id}`);
		const parts: Uint8Array[] = [];
		for await (const part of data) parts.push(part);
		const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let offset = 0;
		for (const part of parts) {
			all.set(part, offset);
			offset += part.length;
		}
		this.workspace = all;
		if (all.length > 0) this.#restore(new TextDecoder().decode(all));
	}
	async snapshot(id: string, generation: number) {
		this.calls.push(`snapshot:${id}:${generation}`);
		const handle = { id: `snap-${generation}`, generation, createdAt: Date.now() };
		this.snapshots.push(handle);
		this.#snapshotDisks.set(handle.id, this.#disk());
		return handle;
	}
	readonly #snapshotDisks = new Map<string, string>();
	async restoreSnapshot(id: string, handle: SnapshotHandle) {
		this.calls.push(`restore-snapshot:${id}:${handle.generation}`);
		const disk = this.#snapshotDisks.get(handle.id);
		if (disk === undefined) throw new Error("no such snapshot");
		this.#restore(disk);
		this.running = true;
	}
	/** The browser requests the bridge would get, for tests to inspect. */
	readonly browserRequests: BrowserRequest[] = [];
	/**
	 * A browser whose state lives in the bot's Chrome profile on disk, as Chrome's does: its open tabs ("Current
	 * Session") and the sites it is signed in to (a password filled on a site's page signs in). A page opened on a site
	 * with no tab yet gets a new tab. Before anything is opened the page is a checkout (the payment tests' shop).
	 */
	async browser(_id: string, botUser: string, request: BrowserRequest): Promise<BrowserResult> {
		this.browserRequests.push(request);
		this.addUser(botUser);
		const sessionPath = `${chromeProfileDir(botUser)}/Default/Current Session`;
		const session = JSON.parse(this.files.get(sessionPath)?.data ?? '{"tabs":[],"active":0,"signedIn":[]}') as { tabs: string[]; active: number; signedIn: string[] };
		const save = () => this.files.set(sessionPath, { owner: botUser, mode: 0o600, data: JSON.stringify(session) });
		const current = () => session.tabs[session.active] ?? "https://shop.example/checkout";
		if (request.action === "navigate") {
			const origin = new URL(request.url).origin;
			const tab = session.tabs.findIndex((url) => new URL(url).origin === origin);
			if (tab === -1) session.tabs.push(request.url);
			else session.tabs[tab] = request.url;
			session.active = tab === -1 ? session.tabs.length - 1 : tab;
			save();
		}
		if (request.action === "fill" && /password/i.test(request.ref)) {
			const origin = new URL(current()).origin;
			if (!session.signedIn.includes(origin)) session.signedIn.push(origin);
			save();
		}
		const url = current();
		if (request.action === "snapshot")
			return { url, title: new URL(url).host, snapshot: `Tabs: ${session.tabs.join(", ") || "none"}. Signed in to: ${session.signedIn.join(", ") || "nothing"}.` };
		return { url, title: url === "https://shop.example/checkout" ? "Checkout" : new URL(url).host };
	}

	async runSetup(id: string, script: string) {
		this.calls.push(`setup:${id}:${script.length}`);
		return { code: 0, output: "" };
	}
}
