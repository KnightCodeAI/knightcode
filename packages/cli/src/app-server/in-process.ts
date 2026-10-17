import type { Message } from "@knightcode/app-server-protocol";
import type { Transport } from "./transport.ts";
import { AppServerClient } from "./client.ts";
import { AppServer, type Handlers } from "./server.ts";

const DEFAULT_CAPACITY = 10_000;
/** Queued behind everything a draining end sent; reaching it closes both ends. */
const CLOSE = Symbol("close");

interface End {
	transport: Transport;
	deliver(message: Message): void;
	deliverClose(): void;
	shut(): void;
}

function createEnd(capacity: number, peer: () => End): End {
	const messageHandlers: Array<(message: unknown) => void> = [];
	const closeHandlers: Array<() => void> = [];
	const queue: Array<Message | typeof CLOSE> = [];
	let scheduled = false;
	let closing = false;
	let closed = false;
	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(flush);
	};
	const flush = () => {
		scheduled = false;
		while (queue.length > 0 && !closed) {
			const item = queue.shift()!;
			if (item === CLOSE) {
				end.shut();
				peer().shut();
				return;
			}
			for (const handler of messageHandlers) handler(item);
		}
	};
	const end: End = {
		deliver(message) {
			if (closed) return;
			if (queue.length >= capacity) {
				// A peer that stopped consuming; growing without bound would hide it.
				end.shut();
				peer().shut();
				return;
			}
			queue.push(message);
			schedule();
		},
		deliverClose() {
			if (closed) return;
			queue.push(CLOSE);
			schedule();
		},
		shut() {
			if (closed) return;
			closed = true;
			queue.length = 0;
			for (const handler of closeHandlers) handler();
		},
		transport: {
			// Messages pass as objects, not copies: receivers must not mutate what they get.
			send: (message) => {
				if (!closed && !closing) peer().deliver(message);
			},
			onMessage: (handler) => messageHandlers.push(handler),
			// No half-close in process: a peer's close() ends both directions (onClose), after its queued messages.
			onInputEnd: () => {},
			onClose: (handler) => closeHandlers.push(handler),
			close: (mode = "drain") => {
				if (closed) return;
				if (mode === "abort") {
					end.shut();
					peer().shut();
					return;
				}
				// Stop sending; the peer receives what is already queued, then both ends close.
				closing = true;
				peer().deliverClose();
			},
		},
	};
	return end;
}

/** Two connected transports over bounded in-memory queues, with stdio's envelopes. */
export function createInProcessPair(capacity = DEFAULT_CAPACITY): { client: Transport; server: Transport } {
	const client: End = createEnd(capacity, () => server);
	const server: End = createEnd(capacity, () => client);
	return { client: client.transport, server: server.transport };
}

export interface InProcessClientOptions {
	handlers: Handlers;
	version: string;
	mode?: "desktop" | "tui";
	onInitialized?(connection: AppServer): void;
	onClose?(connection: AppServer): void;
}

/** A client connected to a fresh server connection using the same wire envelopes as stdio. */
export function createInProcessClient(options: InProcessClientOptions): AppServerClient {
	const { client, server } = createInProcessPair();
	new AppServer({ ...options, transport: server, mode: options.mode ?? "tui" });
	return new AppServerClient(client);
}
