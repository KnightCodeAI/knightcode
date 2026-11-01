// The remote environment over any transport: the conformance suite over a child process and over a WebSocket whose
// other end runs the daemon, and a write cut off mid-flight reporting an unknown outcome over either.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import { registerEnvConformance } from "@knightcode/durable/testing";
import { afterAll, describe, expect, it } from "vitest";
import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { childProcessTransport, type Transport, type WebSocketLike, webSocketTransport } from "../src/transport.ts";
import { daemon } from "./daemon.ts";

const connections: Connection[] = [];
const dirs: string[] = [];
afterAll(() => {
	for (const connection of connections) connection.close();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
});

/** Two linked in-memory WebSocket ends that deliver asynchronously, like a network; closing one closes both. */
function socketPair(): [WebSocketLike, WebSocketLike] {
	type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void;
	interface End {
		readyState: number;
		peer: End;
		listeners: Record<"message" | "close" | "error", Set<Listener>>;
		send(data: Uint8Array): void;
		close(code?: number, reason?: string): void;
		addEventListener(type: "message" | "close" | "error", listener: Listener): void;
	}
	const make = (): End => {
		const listeners = { message: new Set<Listener>(), close: new Set<Listener>(), error: new Set<Listener>() };
		const socket: End = {
			readyState: 1,
			peer: undefined as unknown as End,
			send(data: Uint8Array) {
				if (socket.readyState !== 1) return;
				const copy = new Uint8Array(data).buffer;
				setTimeout(() => {
					if (socket.peer.readyState === 1)
						for (const listener of socket.peer.listeners.message) listener({ data: copy });
				}, 0);
			},
			close(code = 1000, reason = "") {
				for (const end of [socket, socket.peer]) {
					if (end.readyState === 3) continue;
					end.readyState = 3;
					setTimeout(() => {
						for (const listener of end.listeners.close) listener({ code, reason });
					}, 0);
				}
			},
			addEventListener(type: "message" | "close" | "error", listener: Listener) {
				listeners[type]?.add(listener);
			},
			listeners,
		};
		return socket;
	};
	const a = make();
	const b = make();
	a.peer = b;
	b.peer = a;
	return [a as unknown as WebSocketLike, b as unknown as WebSocketLike];
}

/** A transport to the daemon over a WebSocket: the far end runs it on a pipe and passes frames through unchanged. */
function daemonOverWebSocket(): Transport {
	const [client, server] = socketPair();
	const pipe = childProcessTransport({ command: [daemon] });
	pipe.onFrame((frame) => server.send(frame));
	pipe.onClose(() => server.close(1011, "daemon exited"));
	server.addEventListener("message", (event) => pipe.send(new Uint8Array(event.data as ArrayBuffer)));
	server.addEventListener("close", () => pipe.close());
	return webSocketTransport(client);
}

const overPipe = () => childProcessTransport({ command: [daemon] });

/** `inner`, cut (closed) right after it carries the first request for `op`, so that request's outcome is unknown. */
function cutAfter(op: string, inner: Transport): Transport {
	return {
		send(frame) {
			inner.send(frame);
			const jsonLength = new DataView(frame.buffer, frame.byteOffset).getUint32(9);
			const json = JSON.parse(new TextDecoder().decode(frame.subarray(13, 13 + jsonLength))) as { op?: string };
			if (json.op === op) inner.close();
		},
		onFrame: (listener) => inner.onFrame(listener),
		onClose: (listener) => inner.onClose(listener),
		close: () => inner.close(),
		...(inner.established ? { established: () => inner.established?.() } : {}),
	};
}

function connect(transport: () => Transport): Connection {
	const connection = new Connection({ transport });
	connections.push(connection);
	return connection;
}

const windows = process.platform === "win32";
const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const options = windows ? { shell: [gitBash, "-c"], symlinks: false, listFiles: true } : { listFiles: true };

for (const [name, transport] of [
	["a child-process transport", overPipe],
	["a WebSocket transport", daemonOverWebSocket],
] as const) {
	const connection = connect(transport);
	registerEnvConformance(
		{ describe, expect, it },
		`RemoteExecutionEnv over ${name}`,
		async (use) => {
			const cwd = mkdtempSync(join(tmpdir(), "knightcode-env-transport-"));
			try {
				await use(
					new RemoteExecutionEnv({ connection, id: "knightcode-env:test", cwd, watch: { pollIntervalMs: 100 } }),
				);
			} finally {
				rmSync(cwd, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
			}
		},
		options,
	);
}

describe("an interrupted write", () => {
	for (const [name, transport] of [
		["a child-process transport", overPipe],
		["a WebSocket transport", daemonOverWebSocket],
	] as const)
		it(`reports an unknown outcome over ${name}`, async () => {
			const cwd = mkdtempSync(join(tmpdir(), "knightcode-env-cut-"));
			dirs.push(cwd);
			const env = new RemoteExecutionEnv({ connection: connect(() => cutAfter("write", transport())), id: "cut", cwd });
			const result = await env.writeFile("a.txt", "hello", BACKGROUND_CONTEXT);
			expect(result.ok ? "ok" : result.error.code).toBe("unknown");
		});
});
