import { randomUUID } from "node:crypto";
import { WebSocket } from "undici";
import { decodeViewerFrame, encodeFrame, type HostFrame, type RelayFrame } from "./protocol.ts";

const RETRY_INITIAL_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export interface RelayWebSocket {
	readonly readyState: number;
	readonly OPEN: number;
	readonly bufferedAmount: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: string, listener: (event: never) => void): void;
	removeEventListener(type: string, listener: (event: never) => void): void;
}

export type RelayHostStatus =
	| { state: "connecting" }
	| { state: "connected"; viewers: number }
	| { state: "retrying"; error: string }
	| { state: "expired" };

export interface RelayHostOptions {
	readonly origin: string;
	readonly token: string;
	readonly roomId?: string;
	readonly sessionName?: string;
	readonly cwd: string;
	onPrompt(text: string): void;
	onAbort(): void;
	onResnapshot(): void;
	onStatus(status: RelayHostStatus): void;
	onRoom(roomId: string): void;
	socketFactory?(url: string, token: string): RelayWebSocket;
}

function defaultSocketFactory(url: string, token: string): RelayWebSocket {
	return new WebSocket(url, { headers: { authorization: `Bearer ${token}` } }) as unknown as RelayWebSocket;
}

/**
 * Maintains the outbound connection to the relay. There is no terminal failure state and no
 * attempt ceiling: losing the relay degrades /remote to a status line and never touches the
 * local session. See "Lifetime and ownership" in the spec.
 */
export class RelayHost {
	readonly #options: RelayHostOptions;
	readonly #abort = new AbortController();
	readonly #roomId: string;
	#socket: RelayWebSocket | undefined;
	#viewers = 0;
	#closed = false;
	#loop: Promise<void> | undefined;

	constructor(options: RelayHostOptions) {
		this.#options = options;
		// Minted here rather than read back from the relay's upgrade response: undici does
		// not surface 101 response headers cleanly, and a client-side id lets the extension
		// print the link before the socket has even opened.
		this.#roomId = options.roomId ?? randomUUID().replaceAll("-", "").toUpperCase();
		options.onRoom(this.#roomId);
	}

	get roomId(): string {
		return this.#roomId;
	}

	get viewers(): number {
		return this.#viewers;
	}

	start(): void {
		this.#loop ??= this.#run();
	}

	send(frame: HostFrame): void {
		if (this.#socket === undefined || this.#socket.readyState !== this.#socket.OPEN) return;
		// Suppressing stream frames with no viewers is the caller's job; see extension.ts.
		try {
			this.#socket.send(encodeFrame(frame));
		} catch {
			// The socket is closing; the retry loop reconnects.
		}
	}

	async close(reason: string): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.send({ v: 1, type: "bye", reason });
		this.#abort.abort();
		this.#socket?.close(1000, reason);
		await this.#loop;
	}

	/** Delete the room server-side. Used by /remote stop; quitting the CLI only marks it offline. */
	async deleteRoom(): Promise<void> {
		await fetch(`${this.#options.origin}/host/stop?room=${this.#roomId}`, {
			method: "POST",
			headers: { authorization: `Bearer ${this.#options.token}` },
		}).catch(() => {
			// The room expires on its own TTL if this fails; never surface it to the terminal.
		});
	}

	#url(): string {
		const url = new URL("/host", this.#options.origin);
		url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
		url.searchParams.set("room", this.#roomId);
		if (this.#options.sessionName) url.searchParams.set("name", this.#options.sessionName);
		url.searchParams.set("cwd", this.#options.cwd);
		return url.toString();
	}

	async #run(): Promise<void> {
		let retryMs = RETRY_INITIAL_MS;
		while (!this.#closed) {
			try {
				this.#options.onStatus({ state: "connecting" });
				await this.#connect();
				retryMs = RETRY_INITIAL_MS;
			} catch (error) {
				if (this.#closed) break;
				const message = error instanceof Error ? error.message : String(error);
				this.#options.onStatus({ state: "retrying", error: message });
				try {
					await this.#delay(retryMs);
				} catch {
					break;
				}
				retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
			}
		}
	}

	#connect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const factory = this.#options.socketFactory ?? defaultSocketFactory;
			const socket = factory(this.#url(), this.#options.token);
			this.#socket = socket;
			let settled = false;
			const finish = (error?: Error): void => {
				if (settled) return;
				settled = true;
				if (this.#socket === socket) this.#socket = undefined;
				if (error) reject(error);
				else resolve();
			};
			socket.addEventListener("open", (() => {
				this.#options.onStatus({ state: "connected", viewers: this.#viewers });
			}) as (event: never) => void);
			socket.addEventListener("message", ((event: { data: unknown }) => {
				this.#onMessage(String(event.data));
			}) as unknown as (event: never) => void);
			socket.addEventListener("close", ((event: { code: number; reason: string }) => {
				if (this.#closed) finish();
				else finish(new Error(`Relay closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`));
			}) as unknown as (event: never) => void);
			socket.addEventListener("error", (() => {
				finish(new Error("Relay connection failed"));
			}) as (event: never) => void);
		});
	}

	#onMessage(raw: string): void {
		const viewerFrame = decodeViewerFrame(raw);
		if (viewerFrame) {
			if (viewerFrame.type === "prompt") this.#options.onPrompt(viewerFrame.text);
			else if (viewerFrame.type === "abort") this.#options.onAbort();
			return;
		}
		let relay: RelayFrame;
		try {
			relay = JSON.parse(raw) as RelayFrame;
		} catch {
			return;
		}
		if (relay.v !== 1) return;
		if (relay.type === "viewer") {
			this.#viewers = relay.count;
			this.#options.onStatus({ state: "connected", viewers: relay.count });
		} else if (relay.type === "resnapshot") {
			this.#options.onResnapshot();
		}
	}

	#delay(milliseconds: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const onAbort = (): void => {
				clearTimeout(timer);
				reject(new Error("Relay host stopped"));
			};
			const timer = setTimeout(() => {
				this.#abort.signal.removeEventListener("abort", onAbort);
				resolve();
			}, milliseconds);
			timer.unref?.();
			this.#abort.signal.addEventListener("abort", onAbort, { once: true });
		});
	}
}
