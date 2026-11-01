// One realtime connection for the whole UI: authenticates with a ticket, keeps each watched thread's view current by
// applying Chord ops in version order, and resumes from the last version after a reconnect.
import {
	type ClientFrame,
	type ConversationView,
	decodeFrame,
	encodeFrame,
	type ServerEvent,
	type ServerFrame,
	type WebSocketLike,
} from "@knightcode/bots-protocol";
import { applyImmutable } from "@knightcode/chord/delta";

/** A thread: a bot's chat or a group chat. */
export type ThreadTarget = { botId: string } | { groupId: string };

type Watch = {
	target: ThreadTarget;
	version?: number;
	view?: ConversationView;
	listeners: Set<(view: ConversationView) => void>;
};

const OPEN = 1;
const RECONNECT_MS = [250, 500, 1_000, 2_000, 5_000];

export const threadKey = (target: ThreadTarget) =>
	"botId" in target ? `bot:${target.botId}` : `group:${target.groupId}`;

/** Live threads and events over one socket. */
export class ThreadSocket {
	private readonly connect: () => WebSocketLike;
	private readonly ticket: () => Promise<string>;
	private socket?: WebSocketLike;
	private ready = false;
	private attempts = 0;
	private closed = false;
	private readonly watches = new Map<string, Watch>();
	private readonly eventListeners = new Set<(event: ServerEvent) => void>();
	private readonly errorListeners = new Set<(code: string, message: string) => void>();
	private readonly queue: ClientFrame[] = [];

	constructor(connect: () => WebSocketLike, ticket: () => Promise<string>) {
		this.connect = connect;
		this.ticket = ticket;
	}

	/** Calls `listener` with every new view of `target` until the returned function is called. */
	watch(target: ThreadTarget, listener: (view: ConversationView) => void): () => void {
		const key = threadKey(target);
		let watch = this.watches.get(key);
		if (!watch) {
			watch = { target, listeners: new Set() };
			this.watches.set(key, watch);
			this.send({ type: "subscribe", ...target });
		} else if (watch.view) listener(watch.view);
		watch.listeners.add(listener);
		return () => {
			watch.listeners.delete(listener);
			if (watch.listeners.size > 0) return;
			this.watches.delete(key);
			this.send({ type: "unsubscribe", ...target });
		};
	}

	/** The last view of a watched thread. */
	view(target: ThreadTarget): ConversationView | undefined {
		return this.watches.get(threadKey(target))?.view;
	}

	onEvent(listener: (event: ServerEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onError(listener: (code: string, message: string) => void): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	/** Sends a message; while a run is going it steers that run. */
	submit(
		target: ThreadTarget,
		text: string,
		extra: { attachments?: string[]; replyTo?: string; quote?: string } = {},
	): string {
		const requestId = crypto.randomUUID();
		this.send({ type: "submit", ...target, text, requestId, ...extra });
		return requestId;
	}

	stop(target: ThreadTarget): void {
		this.send({ type: "stop", ...target });
	}

	answer(target: ThreadTarget, entryId: string, value: string): void {
		this.send({ type: "answer", ...target, entryId, value, requestId: crypto.randomUUID() });
	}

	/** Closes the connection for good. */
	close(): void {
		this.closed = true;
		this.socket?.close();
	}

	private send(frame: ClientFrame): void {
		this.queue.push(frame);
		if (!this.socket) void this.open();
		else this.flush();
	}

	private flush(): void {
		if (!this.ready || !this.socket || this.socket.readyState !== OPEN) return;
		for (const frame of this.queue.splice(0)) this.socket.send(encodeFrame(frame));
	}

	private async open(): Promise<void> {
		const socket = this.connect();
		this.socket = socket;
		this.ready = false;
		let started = false;
		const start = async () => {
			if (started) return;
			started = true;
			socket.send(encodeFrame({ type: "auth", ticket: await this.ticket() }));
		};
		socket.addEventListener("message", (event) => this.receive(String(event.data)));
		socket.addEventListener("close", () => this.reconnect(socket));
		socket.addEventListener("open", () => void start());
		// The in-memory fake opens synchronously; a browser socket fires "open" later.
		if (socket.readyState === OPEN) await start();
	}

	private reconnect(socket: WebSocketLike): void {
		if (this.closed || socket !== this.socket) return;
		this.socket = undefined;
		this.ready = false;
		const delay = RECONNECT_MS[Math.min(this.attempts++, RECONNECT_MS.length - 1)];
		setTimeout(() => {
			if (this.closed) return;
			// Resume every watched thread from the version it holds, so nothing is missed or repeated.
			for (const watch of this.watches.values())
				this.queue.push({ type: "subscribe", ...watch.target, since: watch.version });
			void this.open();
		}, delay);
	}

	private receive(text: string): void {
		let frame: ServerFrame;
		try {
			frame = decodeFrame(text) as ServerFrame;
		} catch {
			return;
		}
		if (frame.type === "ready") {
			this.ready = true;
			this.attempts = 0;
			this.flush();
		} else if (frame.type === "event") for (const listener of this.eventListeners) listener(frame.event);
		else if (frame.type === "error") for (const listener of this.errorListeners) listener(frame.code, frame.message);
		else if (frame.type === "view" || frame.type === "ops") this.applyThread(frame);
	}

	private applyThread(frame: Extract<ServerFrame, { type: "view" | "ops" }>): void {
		const target: ThreadTarget = "botId" in frame ? { botId: frame.botId } : { groupId: frame.groupId };
		const watch = this.watches.get(threadKey(target));
		if (!watch) return;
		if (frame.type === "view") {
			watch.view = frame.view;
			watch.version = frame.version;
		} else {
			if (watch.version === undefined || frame.version <= watch.version) return;
			if (frame.version !== watch.version + 1 || !watch.view) {
				// A gap: ask again from the version held, and take whatever comes back.
				this.send({ type: "subscribe", ...target, since: watch.version });
				return;
			}
			watch.view = applyImmutable(watch.view, frame.ops);
			watch.version = frame.version;
		}
		for (const listener of watch.listeners) listener(watch.view);
	}
}
