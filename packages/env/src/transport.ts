import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * How a `Connection` reaches a knightcode-env daemon: whole frames in each direction (docs/protocol.md: a 4-byte length,
 * then type, id, JSON length, JSON and payload). A child process speaks them on its stdin and stdout; a WebSocket
 * carries one per binary message. Framing above this, cancellation, session handles and unknown outcomes are the
 * connection's.
 */
export interface Transport {
	/** Sends one whole frame. Ignored once closed. */
	send(frame: Uint8Array): void;
	onFrame(listener: (frame: Uint8Array) => void): void;
	/**
	 * Called once, when the transport ends for any reason (including `close`). `code` is `spawn_error` when the daemon
	 * could not be started at all.
	 */
	onClose(listener: (reason: string, details?: { code?: string }) => void): void;
	close(): void;
	/** The daemon answered `hello`: from now on its exit ends the transport at once. */
	established?(): void;
	/** What the daemon wrote to stderr while starting, for an error about a start that failed. */
	diagnostics?(): string;
	/** When bytes last arrived, even part of a frame, so a slow large frame does not look like silence. */
	lastActivity?(): number;
}

/** The largest frame either side sends. */
export const MAX_FRAME = 16 * 1024 * 1024;
/** How much stderr a startup error shows: short, because a tool error can reach the model. */
const STDERR_TAIL_CHARS = 2000;

/** Calls each listener once with the first close, and never again. */
function closer() {
	const listeners = new Set<(reason: string, details?: { code?: string }) => void>();
	let closed = false;
	return {
		get closed() {
			return closed;
		},
		add: (listener: (reason: string, details?: { code?: string }) => void) => void listeners.add(listener),
		fire(reason: string, details?: { code?: string }) {
			if (closed) return;
			closed = true;
			for (const listener of listeners) listener(reason, details);
		},
	};
}

export interface ChildProcessTransportOptions {
	/** The program and arguments that start the daemon, before its `serve --token <hex>` arguments. */
	command: readonly string[];
	/** Receives the daemon's stderr, and anything a shell printed before it started. */
	onLog?: (text: string) => void;
}

/**
 * The daemon as a child process on stdin and stdout (directly, or through `ssh`). Shell startup files may print before
 * the daemon runs, so everything before its `PI-ENV <token>` line is skipped. Until `established`, an exit waits for the
 * pipes to drain so the startup error carries all of stderr; afterwards an exit ends the transport at once, even while
 * a process the daemon started holds the pipes open.
 */
export function childProcessTransport(options: ChildProcessTransportOptions): Transport {
	const frames = new Set<(frame: Uint8Array) => void>();
	const done = closer();
	const [program, ...args] = options.command;
	const token = randomBytes(16).toString("hex");
	let established = false;
	let stderrTail = "";
	let activity = Date.now();
	if (program === undefined) {
		queueMicrotask(() => done.fire("No daemon command", { code: "spawn_error" }));
		return {
			send: () => {},
			onFrame: (listener) => void frames.add(listener),
			onClose: done.add,
			close: () => done.fire("Connection closed"),
		};
	}
	const child = spawn(program, [...args, "serve", "--token", token], { stdio: ["pipe", "pipe", "pipe"] });
	const finish = (reason: string, details?: { code?: string }) => {
		if (done.closed) return;
		child.stdin.end();
		child.kill();
		done.fire(reason, details);
	};
	const reader = new StreamFrames(Buffer.from(`PI-ENV ${token}\n`, "utf8"), {
		frame: (frame) => {
			for (const listener of frames) listener(frame);
		},
		noise: (text) => options.onLog?.(text),
		corrupt: () => finish("Corrupt frame from knightcode-env"),
	});
	child.stdout.on("data", (chunk: Buffer) => {
		if (done.closed) return;
		activity = Date.now();
		reader.push(chunk);
	});
	child.stderr.setEncoding("utf8").on("data", (text: string) => {
		if (!established) stderrTail = (stderrTail + text).slice(-STDERR_TAIL_CHARS);
		options.onLog?.(text);
	});
	child.once("error", (error) => finish(error.message, { code: "spawn_error" }));
	child.on("exit", () => {
		if (established) finish("knightcode-env connection lost");
	});
	child.on("close", (code) =>
		finish(
			established ? "knightcode-env connection lost" : `knightcode-env exited with code ${code} before it was ready`,
		),
	);
	child.stdin.on("error", () => {});
	return {
		send(frame) {
			if (!done.closed) child.stdin.write(frame);
		},
		onFrame: (listener) => void frames.add(listener),
		onClose: done.add,
		close: () => finish("Connection closed"),
		established() {
			established = true;
			stderrTail = "";
		},
		diagnostics: () => stderrTail,
		lastActivity: () => activity,
	};
}

/** Just what `webSocketTransport` needs of a WebSocket: the browser's, the Workers runtime's, or `ws`'s. */
export interface WebSocketLike {
	binaryType?: string;
	readonly readyState?: number;
	send(data: Uint8Array): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: "open", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	addEventListener(type: "close", listener: (event: { code?: number; reason?: string }) => void): void;
	addEventListener(type: "error", listener: (event: unknown) => void): void;
}

const CONNECTING = 0;
const OPEN = 1;

/**
 * A daemon reached over a WebSocket (a cloud computer, for one): each binary message is one whole frame. Frames sent
 * before the socket opens wait for it. A message that is not a well-formed frame ends the transport.
 */
export function webSocketTransport(socket: WebSocketLike): Transport {
	const frames = new Set<(frame: Uint8Array) => void>();
	const done = closer();
	const waiting: Uint8Array[] = [];
	let activity = Date.now();
	try {
		socket.binaryType = "arraybuffer";
	} catch {
		// Some implementations fix the binary type; ArrayBuffer and Uint8Array data are both handled below.
	}
	const finish = (reason: string) => {
		if (done.closed) return;
		try {
			socket.close(1000, "closed");
		} catch {
			// Already closing.
		}
		done.fire(reason);
	};
	socket.addEventListener("open", () => {
		for (const frame of waiting.splice(0)) socket.send(frame);
	});
	socket.addEventListener("message", (event) => {
		if (done.closed) return;
		activity = Date.now();
		const data = event.data;
		const frame =
			data instanceof ArrayBuffer
				? new Uint8Array(data)
				: ArrayBuffer.isView(data)
					? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
					: undefined;
		if (!frame || frame.length < 13) return finish("Corrupt frame from knightcode-env");
		const length = new DataView(frame.buffer, frame.byteOffset).getUint32(0);
		if (length < 9 || length > MAX_FRAME || frame.length !== 4 + length)
			return finish("Corrupt frame from knightcode-env");
		for (const listener of frames) listener(frame);
	});
	socket.addEventListener("close", (event) =>
		done.fire(`knightcode-env socket closed${event.reason ? `: ${event.reason}` : ""}`),
	);
	socket.addEventListener("error", () => finish("knightcode-env socket failed"));
	return {
		send(frame) {
			if (done.closed) return;
			if (socket.readyState === CONNECTING) waiting.push(frame);
			else if (socket.readyState === undefined || socket.readyState === OPEN) socket.send(frame);
		},
		onFrame: (listener) => void frames.add(listener),
		onClose: done.add,
		close: () => finish("Connection closed"),
		lastActivity: () => activity,
	};
}

/**
 * Turns a byte stream into whole frames: skips everything before `marker`, then splits on each frame's 4-byte length
 * without concatenating on every chunk.
 */
class StreamFrames {
	private chunks: Buffer[] = [];
	private buffered = 0;
	private synced = false;
	private readonly marker: Buffer;
	private readonly sink: { frame(frame: Uint8Array): void; noise(text: string): void; corrupt(): void };

	constructor(marker: Buffer, sink: { frame(frame: Uint8Array): void; noise(text: string): void; corrupt(): void }) {
		this.marker = marker;
		this.sink = sink;
	}

	push(chunk: Buffer): void {
		this.chunks.push(chunk);
		this.buffered += chunk.length;
		if (!this.synced) {
			const all = this.peek(this.buffered);
			const index = all.indexOf(this.marker);
			if (index === -1) {
				if (this.buffered > 1024 * 1024) this.consume(this.buffered - this.marker.length);
				return;
			}
			const noise = all.subarray(0, index).toString("utf8").trim();
			if (noise !== "") this.sink.noise(noise);
			this.consume(index + this.marker.length);
			this.synced = true;
		}
		while (this.buffered >= 4) {
			const length = this.peek(4).readUInt32BE(0);
			if (length < 9 || length > MAX_FRAME) return this.sink.corrupt();
			if (this.buffered < 4 + length) return;
			// A plain copy, not a view of the receive buffer.
			const frame = new Uint8Array(this.peek(4 + length));
			this.consume(4 + length);
			this.sink.frame(frame);
		}
	}

	/** The first `length` buffered bytes as one buffer, without consuming them. */
	private peek(length: number): Buffer {
		if (this.chunks[0]!.length < length) this.chunks = [Buffer.concat(this.chunks)];
		return this.chunks[0]!.subarray(0, length);
	}

	private consume(length: number): void {
		this.buffered -= length;
		while (length > 0) {
			const first = this.chunks[0]!;
			if (first.length <= length) {
				this.chunks.shift();
				length -= first.length;
			} else {
				this.chunks[0] = first.subarray(length);
				length = 0;
			}
		}
	}
}
