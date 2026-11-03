// The computer on Cloudflare Containers (spec section 7): the computer object's own container (one per user, 2 vCPU,
// 6 GiB, 16 GB, set in wrangler.jsonc), reached through the bridge on one container port. The bridge runs
// knightcode-env as each bot's OS user, serves each bot's screen over VNC, exports and imports the workspace, and runs
// the setup script. Every bridge request carries the token the container was started with.
import { webSocketTransport } from "@knightcode/env";
import type { Transport } from "@knightcode/env";
import type { BrowserRequest, BrowserResult, DesktopRequest, DesktopResult } from "./browser-tools.ts";
import type { CapabilityUrl, ComputerProvider, SnapshotHandle } from "./provider.ts";

export const BRIDGE_PORT = 8080;
const READY_TIMEOUT_MS = 90_000;

export interface CloudflareOptions {
	/** Shared with the bridge at start; the bridge refuses requests without it. */
	bridgeToken: string;
	/** Issues the screen URL for a bot (the computer object's capability check). */
	screenUrl(botId: string, mode: "view" | "control"): Promise<CapabilityUrl>;
	/** Extra environment for the container: time zone and language matched to the exit address, proxy settings. */
	env?: Record<string, string>;
}

async function* chunks(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
	if (!body) return;
	const reader = body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		yield value;
	}
}

const toStream = (source: AsyncIterable<Uint8Array>) => {
	const iterator = source[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await iterator.next();
			if (next.done) controller.close();
			else controller.enqueue(next.value);
		},
	});
};

export class CloudflareComputerProvider implements ComputerProvider {
	readonly #container: Container;
	readonly #options: CloudflareOptions;

	constructor(container: Container, options: CloudflareOptions) {
		this.#container = container;
		this.#options = options;
	}

	/** A request to the bridge; `path` includes any query. */
	bridge(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("x-bridge-token", this.#options.bridgeToken);
		return this.#container.getTcpPort(BRIDGE_PORT).fetch(`http://computer${path}`, { ...init, headers });
	}

	async #ready(): Promise<void> {
		const deadline = Date.now() + READY_TIMEOUT_MS;
		for (;;) {
			try {
				if ((await this.bridge("/health")).ok) return;
			} catch {
				// Not listening yet.
			}
			if (Date.now() > deadline) throw new Error("the computer did not start");
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	#env() {
		return { BRIDGE_TOKEN: this.#options.bridgeToken, ...this.#options.env };
	}

	async provision(_id: string): Promise<void> {
		if (!this.#container.running) this.#container.start({ enableInternet: true, env: this.#env() });
		await this.#ready();
	}

	async reconnect(_id: string): Promise<boolean> {
		if (!this.#container.running) return false;
		try {
			return (await this.bridge("/health")).ok;
		} catch {
			return false;
		}
	}

	async stop(_id: string): Promise<void> {
		if (this.#container.running) await this.#container.destroy();
	}

	async destroy(id: string): Promise<void> {
		await this.stop(id);
	}

	async transport(_id: string, botUser: string): Promise<Transport> {
		const response = await this.bridge(`/env?user=${encodeURIComponent(botUser)}`, { headers: { upgrade: "websocket" } });
		const socket = response.webSocket;
		if (!socket) throw new Error(`the computer refused the shell (${response.status})`);
		socket.accept();
		return webSocketTransport(socket as unknown as Parameters<typeof webSocketTransport>[0]);
	}

	screen(_id: string, botId: string, mode: "view" | "control"): Promise<CapabilityUrl> {
		return this.#options.screenUrl(botId, mode);
	}

	async vnc(_id: string, botUser: string): Promise<WebSocket | undefined> {
		return (await this.bridge(`/vnc?user=${encodeURIComponent(botUser)}`, { headers: { upgrade: "websocket" } })).webSocket ?? undefined;
	}

	async *exportWorkspace(_id: string): AsyncIterable<Uint8Array> {
		// The bridge closes every Chrome first, so profiles are consistent on disk.
		const response = await this.bridge("/export", { method: "POST" });
		if (!response.ok) throw new Error(`export failed (${response.status})`);
		yield* chunks(response.body);
	}

	async importWorkspace(_id: string, data: AsyncIterable<Uint8Array>): Promise<void> {
		const response = await this.bridge("/import", { method: "POST", body: toStream(data) });
		if (!response.ok) throw new Error(`import failed (${response.status}): ${await response.text()}`);
	}

	async snapshot(_id: string, generation: number): Promise<SnapshotHandle> {
		const snapshot = await this.#container.snapshotContainer({ name: `generation-${generation}` });
		return { id: snapshot.id, generation, createdAt: Date.now() };
	}

	async restoreSnapshot(_id: string, handle: SnapshotHandle): Promise<void> {
		if (this.#container.running) await this.#container.destroy();
		this.#container.start({ enableInternet: true, env: this.#env(), containerSnapshot: { id: handle.id } });
		await this.#ready();
	}

	async browser(_id: string, botUser: string, request: BrowserRequest): Promise<BrowserResult> {
		const response = await this.bridge(`/browser?user=${encodeURIComponent(botUser)}`, { method: "POST", body: JSON.stringify(request) });
		return (await response.json()) as BrowserResult;
	}

	async desktop(_id: string, botUser: string, request: DesktopRequest): Promise<DesktopResult> {
		const response = await this.bridge(`/desktop?user=${encodeURIComponent(botUser)}`, { method: "POST", body: JSON.stringify(request) });
		return (await response.json()) as DesktopResult;
	}

	async runSetup(_id: string, script: string): Promise<{ code: number; output: string }> {
		const response = await this.bridge("/setup", { method: "POST", body: script });
		if (!response.ok) throw new Error(`setup failed to start (${response.status})`);
		return (await response.json()) as { code: number; output: string };
	}
}
