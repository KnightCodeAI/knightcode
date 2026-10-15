/**
 * Routing between windows and the one app server connection (desktop-shell.md sections 4.2-4.3).
 * Plain logic, no Electron: main wires it to MessagePorts and the child process.
 */

import type { Message, RequestId, Response } from "@knightcode/app-server-protocol";

export interface WindowLink {
	id: number;
	send(message: unknown): void;
	isFocused(): boolean;
	/** When the window last had focus, for picking a holder; 0 if never. */
	lastFocusedAt(): number;
}

export interface RouterServer {
	/** False when no child can take the message. */
	send(message: Message): boolean;
	initializeResult(): unknown | undefined;
}

/** Broadcast by the server to every connection; every window gets them (architecture.md section 4.5). */
const SIDEBAR = new Set([
	"thread/started",
	"thread/status/changed",
	"thread/name/updated",
	"thread/archived",
	"thread/deleted",
	"thread/turn/completed",
	"account/login/updated",
	"account/updated",
]);

/** Requests whose success makes the sender hold the thread. */
const HOLDING = new Set(["thread/start", "thread/resume", "thread/fork", "turn/start", "turn/queue/add"]);

/** The window id of a pending request whose window closed or reloaded. */
const GONE = -1;

interface Pending {
	windowId: number;
	clientId: RequestId;
	method: string;
	params: Record<string, unknown>;
}

interface ServerRequest {
	threadId: string;
	windowId: number;
	message: Message;
}

const isRequest = (m: Message): m is Extract<Message, { method: string; id: RequestId }> => "method" in m && "id" in m;
const isNotification = (m: Message) => "method" in m && !("id" in m);

function threadOf(params: Record<string, unknown> | undefined): string | undefined {
	if (!params) return undefined;
	if (typeof params.threadId === "string") return params.threadId;
	const thread = params.thread as { id?: unknown } | undefined;
	if (typeof thread?.id === "string") return thread.id;
	const turn = params.turn as { threadId?: unknown } | undefined;
	if (typeof turn?.threadId === "string") return turn.threadId;
	return undefined;
}

export class Router {
	private readonly server: RouterServer;
	private readonly windows = new Map<number, WindowLink>();
	private readonly pending = new Map<string, Pending>();
	private readonly holders = new Map<string, Set<number>>();
	private readonly lastStarter = new Map<string, number>();
	/** Keyed by the server's request id, sent to windows unchanged. */
	private readonly serverRequests = new Map<string, ServerRequest>();
	/** Threads whose last status was active, from the sidebar notifications every connection gets. */
	private readonly active = new Set<string>();

	constructor(server: RouterServer) {
		this.server = server;
	}

	attach(window: WindowLink): void {
		this.windows.set(window.id, window);
	}

	/** A closed window releases everything it held; its server requests move on (section 4.3). */
	detach(windowId: number): void {
		this.windows.delete(windowId);
		for (const [threadId, set] of this.holders) if (set.has(windowId)) this.release(windowId, threadId);
		// Kept, not dropped: a late holding response must still release the server's subscription. A reload
		// reattaches the same id, so the entries stop pointing at it.
		for (const pending of this.pending.values()) if (pending.windowId === windowId) pending.windowId = GONE;
	}

	activeThreads(): number {
		return this.active.size;
	}

	heldThreads(windowId?: number): string[] {
		return [...this.holders].filter(([, set]) => windowId === undefined || set.has(windowId)).map(([id]) => id);
	}

	fromWindow(windowId: number, message: Message): void {
		if (isRequest(message)) {
			const params = (message.params ?? {}) as Record<string, unknown>;
			if (message.method === "initialize") {
				const result = this.server.initializeResult();
				this.toWindow(
					windowId,
					result
						? { id: message.id, result }
						: { id: message.id, error: { code: "notInitialized", message: "the app server is starting" } },
				);
				return;
			}
			if (message.method === "thread/unsubscribe" && typeof params.threadId === "string") {
				// Forwarding would drop main's one subscription out from under the windows that hold it.
				const set = this.holders.get(params.threadId);
				if (set && !set.has(windowId)) {
					this.toWindow(windowId, { id: message.id, result: { status: "notSubscribed" } });
					return;
				}
				if (set && set.size > 1) {
					this.release(windowId, params.threadId);
					this.toWindow(windowId, { id: message.id, result: { status: "unsubscribed" } });
					return;
				}
				this.release(windowId, params.threadId, false);
			}
			const serverId = `w${windowId}:${message.id}`;
			// Between an exit and the next child, serverRestarted() has already run: nothing else would answer.
			if (!this.server.send({ ...message, id: serverId })) {
				this.toWindow(windowId, {
					id: message.id,
					error: { code: "serverRestarted", message: "KnightCode is not running" },
				});
				return;
			}
			this.pending.set(serverId, { windowId, clientId: message.id, method: message.method, params });
			return;
		}
		if (isNotification(message)) return; // `initialized` is main's own.
		// A response: the window answering a server request it was given.
		const key = String((message as Response).id);
		const request = this.serverRequests.get(key);
		if (!request || request.windowId !== windowId) return;
		this.serverRequests.delete(key);
		this.server.send(message);
	}

	fromServer(message: Message): void {
		if (isRequest(message)) return this.serverRequest(message);
		if (isNotification(message)) return this.notification(message as { method: string; params?: unknown });
		const response = message as Response;
		const id = String(response.id);
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if ("result" in response && HOLDING.has(pending.method)) {
			const result = response.result as Record<string, unknown>;
			const threadId = threadOf(result) ?? threadOf(pending.params);
			if (threadId && this.windows.has(pending.windowId)) {
				this.hold(pending.windowId, threadId);
				if (pending.method === "turn/start") this.lastStarter.set(threadId, pending.windowId);
			} else if (threadId && !this.holders.has(threadId)) {
				this.server.send({ id: `m:release:${threadId}`, method: "thread/unsubscribe", params: { threadId } });
			}
		}
		this.toWindow(pending.windowId, { ...response, id: pending.clientId });
	}

	/** The server exited: every forwarded request fails, every open server request is gone. */
	serverRestarted(): void {
		for (const pending of this.pending.values())
			this.toWindow(pending.windowId, {
				id: pending.clientId,
				error: { code: "serverRestarted", message: "KnightCode restarted before answering" },
			});
		this.pending.clear();
		for (const [id, request] of this.serverRequests)
			this.toWindow(request.windowId, { method: "serverRequest/cancelled", params: { id } });
		this.serverRequests.clear();
		this.active.clear();
	}

	private serverRequest(message: Extract<Message, { method: string; id: RequestId }>): void {
		const threadId = threadOf(message.params as Record<string, unknown>);
		const target = threadId ? this.pickHolder(threadId) : undefined;
		// No holder: the server withdraws it once main's last release unsubscribes.
		if (threadId === undefined || target === undefined) return;
		this.serverRequests.set(String(message.id), { threadId, windowId: target, message });
		this.toWindow(target, message);
	}

	private notification(message: { method: string; params?: unknown }): void {
		const params = message.params as Record<string, unknown> | undefined;
		if (message.method === "serverRequest/cancelled") {
			const id = String((params as { id: RequestId }).id);
			const request = this.serverRequests.get(id);
			if (!request) return;
			this.serverRequests.delete(id);
			this.toWindow(request.windowId, message);
			return;
		}
		if (message.method === "thread/replaced") {
			const oldId = params!.oldThreadId as string;
			const newId = (params!.thread as { id: string }).id;
			const set = this.holders.get(oldId);
			for (const windowId of set ?? []) this.toWindow(windowId, message);
			if (set) {
				this.holders.delete(oldId);
				const next = this.holders.get(newId) ?? new Set<number>();
				for (const windowId of set) next.add(windowId);
				this.holders.set(newId, next);
			}
			const starter = this.lastStarter.get(oldId);
			if (starter !== undefined) this.lastStarter.set(newId, starter);
			this.lastStarter.delete(oldId);
			return;
		}
		if (message.method === "thread/status/changed") {
			const { threadId, status } = params as { threadId: string; status: { type: string } };
			if (status.type === "active") this.active.add(threadId);
			else this.active.delete(threadId);
		}
		const threadId = SIDEBAR.has(message.method) ? undefined : threadOf(params);
		if (threadId === undefined) {
			for (const windowId of this.windows.keys()) this.toWindow(windowId, message);
			return;
		}
		for (const windowId of this.holders.get(threadId) ?? []) this.toWindow(windowId, message);
	}

	private hold(windowId: number, threadId: string): void {
		const set = this.holders.get(threadId) ?? new Set<number>();
		set.add(windowId);
		this.holders.set(threadId, set);
	}

	/**
	 * Drop the hold. The last holder leaving unsubscribes the server (unless the caller forwards the
	 * window's own unsubscribe); server requests that went to this window move to the next holder.
	 */
	private release(windowId: number, threadId: string, unsubscribe = true): void {
		const set = this.holders.get(threadId);
		if (!set?.delete(windowId)) return;
		if (this.lastStarter.get(threadId) === windowId) this.lastStarter.delete(threadId);
		if (set.size === 0) {
			this.holders.delete(threadId);
			if (unsubscribe)
				this.server.send({ id: `m:release:${threadId}`, method: "thread/unsubscribe", params: { threadId } });
		}
		for (const [id, request] of this.serverRequests) {
			if (request.threadId !== threadId || request.windowId !== windowId) continue;
			if (this.windows.has(windowId)) this.toWindow(windowId, { method: "serverRequest/cancelled", params: { id } });
			const next = this.pickHolder(threadId);
			if (next === undefined) {
				this.serverRequests.delete(id);
				continue;
			}
			request.windowId = next;
			this.toWindow(next, request.message);
		}
	}

	/** The last turn/start sender if it still holds, else the focused holder, else the most recently focused. */
	private pickHolder(threadId: string): number | undefined {
		const set = this.holders.get(threadId);
		if (!set || set.size === 0) return undefined;
		const starter = this.lastStarter.get(threadId);
		if (starter !== undefined && set.has(starter)) return starter;
		const links = [...set].map((id) => this.windows.get(id)).filter((w): w is WindowLink => w !== undefined);
		return (links.find((w) => w.isFocused()) ?? links.sort((a, b) => b.lastFocusedAt() - a.lastFocusedAt())[0])?.id;
	}

	private toWindow(windowId: number, message: unknown): void {
		this.windows.get(windowId)?.send(message);
	}
}
