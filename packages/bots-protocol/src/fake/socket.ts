// The fake backend's realtime side: in-memory sockets, thread views with their op logs, and scripted replies.
import { applyImmutable, type JsonValue, type Op } from "@knightcode/chord/delta";
import type { ConversationView, Entry } from "../entities.ts";
import {
	type ClientFrame,
	decodeFrame,
	encodeFrame,
	type ServerEvent,
	type ServerFrame,
	type WebSocketLike,
} from "../frames.ts";
import { type FakeClock, type ReplyStream, streamWords } from "./stream.ts";

export type ThreadKey = `bot:${string}` | `group:${string}`;
type Target = { botId: string } | { groupId: string };

/** What the hub needs from the rest of the fake. */
export interface HubContext {
	clock: FakeClock;
	/** The text a bot streams when messaged. */
	replyFor(botId: string, prompt: string): string;
	/** Group members in order, the lead and their names, or undefined for an unknown group. */
	group(groupId: string): { memberIds: string[]; leadId: string; names: Record<string, string> } | undefined;
	/** A run started or ended on a bot's thread. */
	onRunState(botId: string, running: boolean): void;
	/** A question card was answered. */
	onAnswered(entryId: string): void;
}

interface Thread {
	key: ThreadKey;
	target: Target;
	version: number;
	view: ConversationView;
	log: { version: number; ops: Op[] }[];
	run?: ReplyStream;
}

const OPEN = 1;
const CLOSED = 3;

// Entries are JSON by construction (no undefined fields), which Chord's op type cannot see.
const json = (value: Entry | ConversationView | string | boolean): JsonValue => value as unknown as JsonValue;

/** Threads and sockets for one fake backend. */
export class FakeHub {
	private readonly ctx: HubContext;
	private readonly threads = new Map<ThreadKey, Thread>();
	private readonly sockets = new Set<FakeSocket>();
	private nextEntry = 1;

	constructor(views: Record<string, ConversationView>, ctx: HubContext) {
		this.ctx = ctx;
		for (const [key, view] of Object.entries(views)) this.thread(key as ThreadKey, view);
	}

	/** Opens a socket that speaks the realtime frames. */
	connect(): WebSocketLike {
		const socket = new FakeSocket(
			this.ctx.clock,
			(frame) => this.receive(socket, frame),
			() => this.sockets.delete(socket),
		);
		this.sockets.add(socket);
		return socket;
	}

	/** The current view of a thread, creating an empty one for a new bot or group. */
	view(key: ThreadKey): ConversationView {
		return this.thread(key).view;
	}

	/** Applies ops to a thread and sends them to its subscribers. */
	commit(key: ThreadKey, ops: Op[]): void {
		const thread = this.thread(key);
		thread.view = applyImmutable(thread.view, ops);
		thread.version += 1;
		thread.log.push({ version: thread.version, ops });
		for (const socket of this.sockets)
			if (socket.subscribed.has(key)) socket.deliver({ type: "ops", ...thread.target, version: thread.version, ops });
	}

	/** Patches every card entry, in any thread, that `match` selects. */
	patchCards(match: (entry: Entry) => boolean, patch: (index: number) => Op[]): void {
		for (const thread of this.threads.values()) {
			const ops = thread.view.entries.flatMap((entry, index) => (match(entry) ? patch(index) : []));
			if (ops.length > 0) this.commit(thread.key, ops);
		}
	}

	/** Sends an event to every signed-in socket. */
	emit(event: ServerEvent): void {
		for (const socket of this.sockets) if (socket.authed) socket.deliver({ type: "event", event });
	}

	private thread(key: ThreadKey, view?: ConversationView): Thread {
		let thread = this.threads.get(key);
		if (!thread) {
			const id = key.slice(key.indexOf(":") + 1);
			const target: Target = key.startsWith("bot:") ? { botId: id } : { groupId: id };
			thread = { key, target, version: 0, view: view ?? { entries: [], running: false, hasEarlier: false }, log: [] };
			this.threads.set(key, thread);
		}
		return thread;
	}

	private receive(socket: FakeSocket, text: string): void {
		let frame: ClientFrame;
		try {
			const decoded = decodeFrame(text);
			if (!isClientFrame(decoded)) throw new Error(`a client cannot send "${decoded.type}"`);
			frame = decoded;
		} catch (error) {
			socket.deliver({
				type: "error",
				code: "bad_frame",
				message: error instanceof Error ? error.message : "bad frame",
			});
			return;
		}
		if (frame.type === "auth") {
			socket.authed = frame.ticket.length > 0;
			socket.deliver(
				socket.authed
					? { type: "ready", accountId: "acct-raghav" }
					: { type: "error", code: "unauthorized", message: "bad ticket" },
			);
			return;
		}
		if (!socket.authed) {
			socket.deliver({ type: "error", code: "unauthorized", message: "send auth first" });
			socket.close(4401, "unauthorized");
			return;
		}
		const key = keyOf(frame);
		if (frame.type === "subscribe") this.subscribe(socket, key, frame.since);
		else if (frame.type === "unsubscribe") socket.subscribed.delete(key);
		else if (frame.type === "submit") this.submit(key, frame.text);
		else if (frame.type === "stop") this.thread(key).run?.stop();
		else this.answer(key, frame.entryId, frame.value);
	}

	private subscribe(socket: FakeSocket, key: ThreadKey, since: number | undefined): void {
		const thread = this.thread(key);
		socket.subscribed.add(key);
		if (since === thread.version) return;
		const missed = since === undefined ? [] : thread.log.filter((entry) => entry.version > since);
		// Resume from the op log when it covers the gap; otherwise send a fresh snapshot.
		if (since !== undefined && missed.length === thread.version - since)
			for (const entry of missed)
				socket.deliver({ type: "ops", ...thread.target, version: entry.version, ops: entry.ops });
		else socket.deliver({ type: "view", ...thread.target, version: thread.version, view: thread.view });
	}

	private submit(key: ThreadKey, text: string): void {
		const thread = this.thread(key);
		this.append(key, { kind: "message", id: this.entryId(), role: "user", text, createdAt: this.ctx.clock.now() });
		// A message sent during a run steers it; the run keeps going.
		if (thread.run) return;
		const turns =
			"botId" in thread.target
				? [{ botId: thread.target.botId, pass: false }]
				: this.groupTurns(thread.target.groupId, text);
		this.startRun(thread, turns, text);
	}

	private groupTurns(groupId: string, text: string): { botId: string; pass: boolean }[] {
		const group = this.ctx.group(groupId);
		if (!group) return [];
		const lower = text.toLowerCase();
		const everyone = lower.includes("@everyone");
		const mentioned = group.memberIds.filter((id) => lower.includes(`@${(group.names[id] ?? id).toLowerCase()}`));
		const speakers = everyone ? group.memberIds : mentioned.length > 0 ? mentioned : [group.leadId];
		// With @everyone, every second member has nothing to add and passes, as real group turns allow.
		return speakers.map((botId, index) => ({ botId, pass: everyone && index % 2 === 1 }));
	}

	private startRun(thread: Thread, turns: { botId: string; pass: boolean }[], prompt: string): void {
		const botId = "botId" in thread.target ? thread.target.botId : undefined;
		const group = !botId;
		this.commit(thread.key, [["s", ["running"], true]]);
		if (botId) this.ctx.onRunState(botId, true);
		let current: ReplyStream | undefined;
		let stopped = false;
		const finish = () => {
			thread.run = undefined;
			this.commit(thread.key, [["s", ["running"], false]]);
			if (botId) this.ctx.onRunState(botId, false);
		};
		const next = (index: number) => {
			const turn = turns[index];
			if (stopped || !turn) return finish();
			if (turn.pass) {
				this.append(thread.key, {
					kind: "turn",
					id: this.entryId(),
					botId: turn.botId,
					outcome: "pass",
					createdAt: this.ctx.clock.now(),
				});
				return next(index + 1);
			}
			const at = thread.view.entries.length;
			this.append(thread.key, {
				kind: "message",
				id: this.entryId(),
				role: "assistant",
				...(group ? { botId: turn.botId } : {}),
				text: "",
				streaming: true,
				createdAt: this.ctx.clock.now(),
			});
			current = streamWords(
				this.ctx.clock,
				this.ctx.replyFor(turn.botId, prompt),
				(chunk) => this.commit(thread.key, [["a", ["entries", at, "text"], chunk]]),
				() => {
					this.commit(thread.key, [["d", ["entries", at, "streaming"]]]);
					next(index + 1);
				},
			);
		};
		thread.run = {
			stop: () => {
				stopped = true;
				current?.stop();
			},
		};
		next(0);
	}

	private answer(key: ThreadKey, entryId: string, value: string): void {
		const index = this.thread(key).view.entries.findIndex(
			(entry) => entry.id === entryId && entry.kind === "card" && entry.card.type === "question",
		);
		if (index < 0) return;
		this.commit(key, [["s", ["entries", index, "card", "answer"], value]]);
		this.ctx.onAnswered(entryId);
	}

	private append(key: ThreadKey, entry: Entry): void {
		this.commit(key, [["p", ["entries"], this.thread(key).view.entries.length, 0, [json(entry)]]]);
	}

	private entryId(): string {
		return `e${this.nextEntry++}`;
	}
}

function keyOf(frame: Exclude<ClientFrame, { type: "auth" }>): ThreadKey {
	return "botId" in frame ? `bot:${frame.botId}` : `group:${frame.groupId}`;
}

const CLIENT_TYPES = new Set(["auth", "subscribe", "unsubscribe", "submit", "stop", "answer"]);
const isClientFrame = (frame: ClientFrame | ServerFrame): frame is ClientFrame => CLIENT_TYPES.has(frame.type);

type MessageListener = (event: { data: unknown }) => void;

/** One in-memory socket. Server frames arrive on the clock, as they would over a network. */
class FakeSocket implements WebSocketLike {
	readyState = OPEN;
	authed = false;
	readonly subscribed = new Set<ThreadKey>();
	private readonly clock: FakeClock;
	private readonly onSend: (text: string) => void;
	private readonly onClose: () => void;
	private readonly listeners = {
		open: new Set<() => void>(),
		close: new Set<() => void>(),
		error: new Set<() => void>(),
		message: new Set<MessageListener>(),
	};

	constructor(clock: FakeClock, onSend: (text: string) => void, onClose: () => void) {
		this.clock = clock;
		this.onSend = onSend;
		this.onClose = onClose;
		clock.setTimeout(() => {
			for (const listener of this.listeners.open) listener();
		}, 0);
	}

	send(data: string): void {
		if (this.readyState !== OPEN) throw new Error("socket is closed");
		this.onSend(data);
	}

	close(_code?: number, _reason?: string): void {
		if (this.readyState === CLOSED) return;
		this.readyState = CLOSED;
		this.onClose();
		this.clock.setTimeout(() => {
			for (const listener of this.listeners.close) listener();
		}, 0);
	}

	deliver(frame: ServerFrame): void {
		const data = encodeFrame(frame);
		this.clock.setTimeout(() => {
			if (this.readyState !== OPEN) return;
			for (const listener of this.listeners.message) listener({ data });
		}, 0);
	}

	addEventListener(type: "open" | "close" | "error", listener: () => void): void;
	addEventListener(type: "message", listener: MessageListener): void;
	addEventListener(type: "open" | "close" | "error" | "message", listener: (() => void) | MessageListener): void {
		(this.listeners[type] as Set<typeof listener>).add(listener);
	}

	removeEventListener(type: "open" | "close" | "error", listener: () => void): void;
	removeEventListener(type: "message", listener: MessageListener): void;
	removeEventListener(type: "open" | "close" | "error" | "message", listener: (() => void) | MessageListener): void {
		(this.listeners[type] as Set<typeof listener>).delete(listener);
	}
}
