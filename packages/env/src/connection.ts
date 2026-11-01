import { stripVTControlCharacters } from "node:util";
import { childProcessTransport, MAX_FRAME, type Transport } from "./transport.ts";

/** Frame types (docs/protocol.md). */
const REQUEST = 1;
const RESULT = 2;
const ERROR = 3;
const EVENT = 4;
const CANCEL = 5;
const PING = 6;

const PING_INTERVAL_MS = 5000;
/** The daemon pings every five seconds; this much silence means the connection is gone. */
const SILENCE_LIMIT_MS = 30_000;
/** How long starting the daemon and its `hello` may take. */
const START_TIMEOUT_MS = 60_000;
/** How many lines of stderr a startup error shows (the transport keeps the last 2000 characters). */
const STDERR_TAIL_LINES = 20;

export type Json = Record<string, unknown>;

/** A failure reported by the daemon, with its Node-style code. */
export class RemoteError extends Error {
	readonly code: string;
	readonly path?: string;
	readonly fields: Json;

	constructor(fields: Json) {
		super(typeof fields.message === "string" ? fields.message : "Remote operation failed");
		this.name = "RemoteError";
		this.code = typeof fields.code === "string" ? fields.code : "unknown";
		if (typeof fields.path === "string") this.path = fields.path;
		this.fields = fields;
	}
}

/** What `hello` reports about the remote machine. */
export interface RemoteInfo {
	protocol: number;
	version: string;
	os: string;
	arch: string;
	home: string;
	tmpdir: string;
	/** Path separator: `/`, or `\\` on Windows. */
	separator: string;
	/** The daemon's working directory, where Node's `path.resolve` would fall back to `process.cwd()`. */
	cwd: string;
	/** Windows: per-drive working directories (`C:` → `C:\\work`) of the `=C:` variables. */
	driveCwds: Record<string, string>;
	pid: number;
	/** Operations added to protocol 1 that this daemon supports, such as `listFiles`; absent from older daemons. */
	features?: string[];
}

/**
 * Node's names for the daemon's system and architecture, which `hello` reports in Rust's spelling: `windows` is
 * `win32`, `macos` is `darwin`, `x86_64` is `x64`, `aarch64` is `arm64`, so they compare with `process.platform` and
 * `process.arch`. Other names are kept.
 */
export function nodePlatform(info: Pick<RemoteInfo, "os" | "arch">): { platform: string; arch: string } {
	const platforms: Record<string, string> = { windows: "win32", macos: "darwin" };
	const archs: Record<string, string> = { x86_64: "x64", aarch64: "arm64", x86: "ia32" };
	return { platform: platforms[info.os] ?? info.os, arch: archs[info.arch] ?? info.arch };
}

export interface ConnectionOptions {
	/**
	 * Command that starts the daemon, before its `serve --token <hex>` arguments, e.g. `["ssh", "-T", "--", "host",
	 * "~/.knightcode/mobile/tools/knightcode-env"]`. A function computes it at each start (detecting and deploying first, for example);
	 * its failure fails that start, and the next request tries again. Give this or `transport`.
	 */
	command?: readonly string[] | (() => Promise<readonly string[]>);
	/**
	 * Opens a transport to a daemon, at the first request and again after a connection is lost (a WebSocket to a cloud
	 * computer, for one). Its failure fails that start, and the next request tries again.
	 */
	transport?: () => Transport | Promise<Transport>;
	/** Receives the daemon's and the transport's diagnostic output. */
	onLog?: (text: string) => void;
}

export interface Reply {
	json: Json;
	payload: Uint8Array;
	/** The daemon session that answered; handles from it are only valid while it lives. */
	session: number;
}

type Pending = {
	resolve: (value: Reply) => void;
	reject: (error: Error) => void;
	onEvent?: (json: Json, payload: Uint8Array) => void;
};

export interface RequestOptions {
	payload?: Uint8Array;
	/** Aborting sends `cancel`; the request still settles with the daemon's result or error. */
	signal?: AbortSignal;
	/** Progress events of the request, such as `exec` output. */
	onEvent?: (json: Json, payload: Uint8Array) => void;
	/** The request's id and session, for `kill`. */
	onStart?: (id: number, session: number) => void;
	/**
	 * Only run in this daemon session, for requests on handles it opened. After the connection was lost and started
	 * again, such requests fail instead of reaching a daemon that never opened the handle.
	 */
	session?: number;
}

/** Lone surrogates become U+FFFD, as Node encodes strings for system calls. */
function wellFormed(_key: string, value: unknown): unknown {
	return typeof value === "string" ? value.toWellFormed() : value;
}

function frame(type: number, id: number, json: Json, payload: Uint8Array = new Uint8Array(0)): Buffer {
	const body = Buffer.from(JSON.stringify(json, wellFormed), "utf8");
	const header = Buffer.alloc(13);
	header.writeUInt32BE(9 + body.length + payload.length, 0);
	header.writeUInt8(type, 4);
	header.writeUInt32BE(id, 5);
	header.writeUInt32BE(body.length, 9);
	return Buffer.concat([header, body, payload]);
}

/** The connection failed or ended; a request may succeed once it is started again. */
function lost(message: string): RemoteError {
	return new RemoteError({ code: "unknown", message, lost: true });
}

/** Whether an error means the connection was lost, not that the daemon refused the request. */
export function isConnectionLost(error: unknown): boolean {
	return error instanceof RemoteError && error.fields.lost === true;
}

function closed(): RemoteError {
	return new RemoteError({ code: "unknown", message: "Connection closed" });
}

/**
 * `message` plus the last lines of `stderr`. The remote machine wrote that text, so terminal escapes and control
 * characters are removed.
 */
function withStderr(message: string, stderr: string): string {
	let text = "";
	for (const char of stripVTControlCharacters(stderr.replace(/\r\n?/g, "\n"))) {
		const code = char.charCodeAt(0);
		if (char === "\n" || char === "\t" || (code >= 0x20 && (code < 0x7f || code > 0x9f))) text += char;
	}
	const lines = text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");
	if (lines.length === 0) return message;
	return `${message}\nremote stderr:\n${lines.slice(-STDERR_TAIL_LINES).join("\n")}`;
}

/** One running daemon, reached through one transport. */
class Session {
	readonly id: number;
	readonly transport: Transport;
	readonly pending = new Map<number, Pending>();
	lastSeen = Date.now();
	timer: ReturnType<typeof setInterval> | undefined;
	live = true;

	constructor(id: number, transport: Transport) {
		this.id = id;
		this.transport = transport;
	}
}

/**
 * One connection to a knightcode-env daemon: started lazily on the first request and started again after it is lost. Requests
 * in flight when it is lost fail with code `unknown`; for mutations their outcome is then unknown.
 */
export class Connection {
	readonly #options: ConnectionOptions;
	#session: Session | undefined;
	#ready: Promise<{ info: RemoteInfo; session: Session }> | undefined;
	#sessions = 0;
	#nextId = 1;
	#closed = false;

	constructor(options: ConnectionOptions) {
		this.#options = options;
	}

	/** Connect if needed and return what the daemon reported about its machine. */
	async info(): Promise<RemoteInfo> {
		return (await this.#connect()).info;
	}

	/** Connect if needed and return the live session's id. */
	async session(): Promise<number> {
		return (await this.#connect()).session.id;
	}

	async request(op: string, json: Json, options: RequestOptions = {}): Promise<Reply> {
		if (options.session !== undefined) {
			const current = this.#session;
			if (current === undefined || current.id !== options.session || !current.live) {
				throw lost("knightcode-env connection lost");
			}
			return this.#send(current, op, json, options);
		}
		const { session } = await this.#connect();
		return this.#send(session, op, json, options);
	}

	/** Stop the daemon; it kills everything it started. */
	close(): void {
		this.#closed = true;
		if (this.#session) this.#teardown(this.#session, closed());
	}

	/** Kill one `exec` without aborting it. */
	kill(id: number, session: number): void {
		const current = this.#session;
		if (current?.id === session && current.live) this.#write(current, frame(CANCEL, id, { mode: "kill" }));
	}

	#connect(): Promise<{ info: RemoteInfo; session: Session }> {
		if (this.#closed) return Promise.reject(closed());
		if (this.#ready === undefined) {
			const ready = this.#start();
			this.#ready = ready;
			// A failed start is not remembered: the next request tries again.
			ready.catch(() => {
				if (this.#ready === ready) this.#ready = undefined;
			});
		}
		return this.#ready;
	}

	#send(session: Session, op: string, json: Json, options: RequestOptions): Promise<Reply> {
		if (!session.live) return Promise.reject(lost("knightcode-env connection lost"));
		const id = this.#nextId++;
		return new Promise((resolve, reject) => {
			const onAbort = () => this.#write(session, frame(CANCEL, id, {}));
			const done = () => options.signal?.removeEventListener("abort", onAbort);
			session.pending.set(id, {
				resolve: (value) => {
					done();
					resolve(value);
				},
				reject: (error) => {
					done();
					reject(error);
				},
				...(options.onEvent ? { onEvent: options.onEvent } : {}),
			});
			options.signal?.addEventListener("abort", onAbort, { once: true });
			options.onStart?.(id, session.id);
			this.#write(session, frame(REQUEST, id, { ...json, op }, options.payload));
			if (options.signal?.aborted) onAbort();
		});
	}

	#write(session: Session, data: Uint8Array): void {
		if (session.live) session.transport.send(data);
	}

	/** A transport from the options: the given factory, or the daemon command on a child process. */
	async #open(): Promise<Transport> {
		const factory = this.#options.transport;
		if (factory) {
			try {
				return await factory();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new RemoteError({ code: "spawn_error", message, lost: true });
			}
		}
		let command: readonly string[];
		try {
			const option = this.#options.command ?? [];
			command = typeof option === "function" ? await option() : option;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new RemoteError({ code: "spawn_error", message, lost: true });
		}
		if (command[0] === undefined) throw new RemoteError({ code: "spawn_error", message: "No daemon command" });
		return childProcessTransport({ command, ...(this.#options.onLog ? { onLog: this.#options.onLog } : {}) });
	}

	async #start(): Promise<{ info: RemoteInfo; session: Session }> {
		const transport = await this.#open();
		if (this.#closed) {
			transport.close();
			throw closed();
		}
		const session = new Session(++this.#sessions, transport);
		this.#session = session;
		let ready = false;
		let startTimer: ReturnType<typeof setTimeout> | undefined;
		const failed = new Promise<never>((_resolve, reject) => {
			startTimer = setTimeout(
				() => reject(lost(`knightcode-env did not answer within ${START_TIMEOUT_MS / 1000} s`)),
				START_TIMEOUT_MS,
			);
			transport.onClose((reason, details) => {
				if (ready) return;
				reject(
					details?.code === "spawn_error"
						? new RemoteError({ code: "spawn_error", message: reason, lost: true })
						: lost(reason),
				);
			});
		});
		failed.catch(() => {});
		transport.onFrame((frame) => this.#onFrame(session, frame));
		// A ready session fails as soon as its transport ends.
		transport.onClose(() => {
			if (ready) this.#teardown(session, lost("knightcode-env connection lost"));
		});
		session.timer = setInterval(() => {
			this.#write(session, frame(PING, 0, {}));
			const seen = Math.max(session.lastSeen, transport.lastActivity?.() ?? 0);
			if (Date.now() - seen > SILENCE_LIMIT_MS) this.#teardown(session, lost("knightcode-env connection timed out"));
		}, PING_INTERVAL_MS);
		session.timer.unref?.();
		try {
			const { json } = await Promise.race([this.#send(session, "hello", { protocol: 1 }, {}), failed]);
			if (json.protocol !== 1) throw lost(`Unsupported protocol ${json.protocol}`);
			ready = true;
			transport.established?.();
			return { info: json as unknown as RemoteInfo, session };
		} catch (error) {
			// Add what the daemon wrote to stderr while starting to whatever ended the start.
			const stderr = transport.diagnostics?.() ?? "";
			const failure =
				error instanceof RemoteError
					? new RemoteError({ ...error.fields, message: withStderr(error.message, stderr) })
					: error instanceof Error
						? error
						: lost(String(error));
			this.#teardown(session, failure);
			throw failure;
		} finally {
			clearTimeout(startTimer);
		}
	}

	#teardown(session: Session, error: Error): void {
		if (!session.live) return;
		session.live = false;
		clearInterval(session.timer);
		if (this.#session === session) {
			this.#session = undefined;
			this.#ready = undefined;
		}
		session.transport.close();
		const pending = [...session.pending.values()];
		session.pending.clear();
		for (const request of pending) request.reject(error);
	}

	#onFrame(session: Session, frame: Uint8Array): void {
		if (!session.live) return;
		session.lastSeen = Date.now();
		const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
		const length = frame.length >= 4 ? view.getUint32(0) : 0;
		if (frame.length < 13 || length < 9 || length > MAX_FRAME || frame.length !== 4 + length) {
			this.#teardown(session, lost("Corrupt frame from knightcode-env"));
			return;
		}
		const type = view.getUint8(4);
		const id = view.getUint32(5);
		const jsonLength = view.getUint32(9);
		let json: Json;
		try {
			if (9 + jsonLength > length) throw new Error("JSON length out of range");
			const parsed: unknown = JSON.parse(new TextDecoder().decode(frame.subarray(13, 13 + jsonLength)));
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
			json = parsed as Json;
		} catch {
			this.#teardown(session, lost("Corrupt frame from knightcode-env"));
			return;
		}
		// A plain Uint8Array copy, like `NodeExecutionEnv`'s reader results, not a view of the frame.
		const payload = frame.slice(13 + jsonLength);
		this.#dispatch(session, type, id, json, payload);
	}

	#dispatch(session: Session, type: number, id: number, json: Json, payload: Uint8Array): void {
		const pending = session.pending.get(id);
		if (type === EVENT) {
			pending?.onEvent?.(json, payload);
			return;
		}
		if (type !== RESULT && type !== ERROR) return;
		if (pending === undefined) return;
		session.pending.delete(id);
		if (type === RESULT) pending.resolve({ json, payload, session: session.id });
		else pending.reject(new RemoteError(json));
	}
}
