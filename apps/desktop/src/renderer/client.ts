/** The window's one MessagePort to main (desktop-shell.md section 4.1): protocol envelopes plus host requests. */

import type {
	ClientMethod,
	Message,
	NotificationMethod,
	NotificationParams,
	ParamsOf,
	RequestId,
	ResultOf,
	ServerRequestMethod,
	ServerRequestParams,
	ServerRequestResult,
} from "@knightcode/app-server-protocol";
import type { HostEvent, HostMethod, HostParams, HostResult, WindowGlobals } from "../shared/host-protocol.ts";

declare global {
	interface Window {
		knightcode: WindowGlobals;
	}
}

export class RequestError extends Error {
	readonly code: string;
	readonly data: unknown;
	constructor(code: string, message: string, data?: unknown) {
		super(message);
		this.code = code;
		this.data = data;
	}
}

export type AnyNotification = {
	[M in NotificationMethod]: { method: M; params: NotificationParams<M> };
}[NotificationMethod];
export type AnyServerRequest = {
	[M in ServerRequestMethod]: { id: RequestId; method: M; params: ServerRequestParams<M> };
}[ServerRequestMethod];

type Waiter = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class Client {
	private port: MessagePort | undefined;
	private readonly queue: unknown[] = [];
	private nextId = 1;
	/** Host and protocol requests share one counter, so an id names exactly one waiter. */
	private readonly waiters = new Map<number, Waiter>();
	private readonly notificationHandlers = new Set<(n: AnyNotification) => void>();
	private readonly requestHandlers = new Set<(r: AnyServerRequest) => void>();
	private readonly eventHandlers = new Set<(e: HostEvent) => void>();

	constructor() {
		window.addEventListener("message", (event) => {
			if (event.source !== window || event.data !== "kc:port" || !event.ports[0]) return;
			this.port?.close();
			this.port = event.ports[0];
			this.port.onmessage = (e) => this.receive(e.data);
			for (const message of this.queue.splice(0)) this.port.postMessage(message);
		});
		// The listener exists now; ask the preload for the port (see preload.ts).
		window.postMessage("kc:hello", window.location.origin);
	}

	private post(message: unknown): void {
		if (this.port) this.port.postMessage(message);
		else this.queue.push(message);
	}

	private receive(data: unknown): void {
		if (typeof data !== "object" || data === null) return;
		if ("event" in data) {
			for (const handler of this.eventHandlers) handler(data as HostEvent);
			return;
		}
		const message = data as Message;
		if ("method" in message && "id" in message) {
			for (const handler of this.requestHandlers) handler(message as AnyServerRequest);
			return;
		}
		if ("method" in message) {
			for (const handler of this.notificationHandlers) handler(message as AnyNotification);
			return;
		}
		const waiter = this.waiters.get(message.id as number);
		if (!waiter) return;
		this.waiters.delete(message.id as number);
		if ("error" in message) {
			const error = message.error as { code: string; message: string; data?: unknown };
			waiter.reject(new RequestError(error.code, error.message, error.data));
		} else waiter.resolve(message.result);
	}

	request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.waiters.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.post({ id, method, params });
		});
	}

	host<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.waiters.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.post({ id, host: method, params });
		});
	}

	respond<M extends ServerRequestMethod>(id: RequestId, result: ServerRequestResult<M>): void {
		this.post({ id, result });
	}

	onNotification(handler: (n: AnyNotification) => void): () => void {
		this.notificationHandlers.add(handler);
		return () => this.notificationHandlers.delete(handler);
	}

	onServerRequest(handler: (r: AnyServerRequest) => void): () => void {
		this.requestHandlers.add(handler);
		return () => this.requestHandlers.delete(handler);
	}

	onHostEvent(handler: (e: HostEvent) => void): () => void {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}
}

export const client = new Client();
