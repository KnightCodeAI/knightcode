/**
 * One app server connection (§4.1, §5.1).
 *
 * Owns the handshake, validates every incoming message against the protocol
 * schemas, dispatches requests to handlers, and keeps the table of requests
 * it has sent the client. Transport-agnostic: stdio and in-process share it.
 */

import {
	ClientRequests,
	ClientNotifications,
	type ClientMethod,
	Envelope,
	type Message,
	type NotificationMethod,
	type NotificationParams,
	type ParamsOf,
	type RequestId,
	type ResultOf,
	type ServerRequestMethod,
	type ServerRequestParams,
	type ServerRequestResult,
	ServerRequests,
} from "@knightcode/app-server-protocol";
import { arch, homedir } from "node:os";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { AppServerError, SubscriberGone } from "./errors.ts";
import type { Transport } from "./transport.ts";

/**
 * A result computed at the moment the response is written (§4.5). thread/resume copies a running turn
 * and subscribes in the same synchronous step that sends the response, so no notification falls between.
 */
export class Commit<R> {
	readonly run: () => R;

	constructor(run: () => R) {
		this.run = run;
	}
}

export function commitOnSend<R>(run: () => R): Commit<R> {
	return new Commit(run);
}

export type Handlers = {
	[M in ClientMethod]?: (params: ParamsOf<M>, connection: AppServer) => Promise<ResultOf<M> | Commit<ResultOf<M>>>;
};

export interface Subscriber {
	readonly id: number;
	readonly mode: "desktop" | "tui";
	/** True once the connection closed or its input ended; a load that finishes later must not subscribe it. */
	readonly isClosed: boolean;
	notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void;
	request<M extends ServerRequestMethod>(
		method: M,
		params: ServerRequestParams<M>,
		signal: AbortSignal,
	): Promise<ServerRequestResult<M>>;
}

export interface AppServerOptions {
	transport: Transport;
	mode: "desktop" | "tui";
	version: string;
	handlers: Handlers;
	onInitialized?(connection: AppServer): void;
	/** stdin ended (or endInput() was called): start shutting down. The connection still answers what it accepted. */
	onInputEnd?(connection: AppServer): void;
	onClose?(connection: AppServer): void;
}

const validators = new Map<TSchema, ReturnType<typeof Compile>>();
function check(schema: TSchema, value: unknown): boolean {
	let validator = validators.get(schema);
	if (!validator) {
		validator = Compile(schema);
		validators.set(schema, validator);
	}
	return validator.Check(value);
}

let nextConnectionId = 1;

interface Outgoing {
	resolve(result: unknown): void;
	reject(error: Error): void;
	resultSchema: TSchema;
}

export class AppServer implements Subscriber {
	readonly id = nextConnectionId++;
	readonly mode: "desktop" | "tui";
	private readonly transport: Transport;
	private readonly options: AppServerOptions;
	private state: "new" | "initializing" | "ready" | "closed" = "new";
	private optedOut: ReadonlySet<string> = new Set();
	private nextRequestId = 1;
	private readonly outgoing = new Map<RequestId, Outgoing>();
	/** Requests accepted and not yet answered; after EOF, output closes once this is empty (§5.6). */
	private readonly dispatching = new Set<Promise<void>>();
	private readonly unfinishedAnswers = new Set<() => void>();
	private inputEnded = false;

	constructor(options: AppServerOptions) {
		this.options = options;
		this.mode = options.mode;
		this.transport = options.transport;
		this.transport.onMessage((message) => this.receive(message));
		this.transport.onInputEnd(() => this.endInput());
		this.transport.onClose(() => this.closed());
	}

	notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void {
		if (this.state === "ready" && !this.optedOut.has(method)) this.transport.send({ method, params });
	}

	request<M extends ServerRequestMethod>(
		method: M,
		params: ServerRequestParams<M>,
		signal: AbortSignal,
	): Promise<ServerRequestResult<M>> {
		if (this.state !== "ready" || this.inputEnded) return Promise.reject(new SubscriberGone());
		if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
		const id = this.nextRequestId++;
		return new Promise<ServerRequestResult<M>>((resolve, reject) => {
			const onAbort = () => {
				if (!this.outgoing.delete(id)) return;
				this.notify("serverRequest/cancelled", { id });
				signal.removeEventListener("abort", onAbort);
				reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			this.outgoing.set(id, {
				resolve: (result) => {
					signal.removeEventListener("abort", onAbort);
					resolve(result as ServerRequestResult<M>);
				},
				reject: (error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				},
				resultSchema: ServerRequests[method].result,
			});
			this.transport.send({ id, method, params });
		});
	}

	get isClosed(): boolean {
		return this.state === "closed" || this.inputEnded;
	}

	/** Drains by default (§5.9): what was already sent still reaches the client. */
	close(mode: "drain" | "abort" = "drain"): void {
		this.transport.close(mode);
	}

	/**
	 * No more input: stdin ended, or the process got a signal. Take no new work, finish what was accepted,
	 * then close output (§5.6). Server requests can no longer be answered, so they fail as a disconnect would.
	 */
	endInput(): void {
		if (this.inputEnded || this.state === "closed") return;
		this.inputEnded = true;
		for (const pending of this.outgoing.values()) pending.reject(new SubscriberGone());
		this.outgoing.clear();
		this.options.onInputEnd?.(this);
		this.closeWhenAnswered();
	}

	/** At the shutdown response deadline, settle accepted work without waiting on user callbacks. */
	settleUnfinishedRequests(): void {
		if (!this.inputEnded && this.state !== "closed") return;
		for (const settle of this.unfinishedAnswers) settle();
		this.unfinishedAnswers.clear();
	}

	private closeWhenAnswered(): void {
		if (this.inputEnded && this.dispatching.size === 0 && this.state !== "closed") this.close("drain");
	}

	private closed(): void {
		if (this.state === "closed") return;
		this.state = "closed";
		this.settleUnfinishedRequests();
		for (const pending of this.outgoing.values()) pending.reject(new SubscriberGone());
		this.outgoing.clear();
		this.options.onClose?.(this);
	}

	private receive(message: unknown): void {
		if (!check(Envelope, message)) {
			// A malformed answer to a server request must still settle it, or the approval waits forever.
			const { id, method } = (message ?? {}) as { id?: RequestId; method?: unknown };
			const pending = method === undefined && id !== undefined ? this.outgoing.get(id) : undefined;
			if (pending) {
				this.outgoing.delete(id!);
				pending.reject(new AppServerError("invalidParams", "Malformed response"));
			} else if (method !== undefined && (typeof id === "number" || (typeof id === "string" && id.length <= 128))) {
				// A malformed request with a usable id must still be answered, or its caller waits forever.
				this.transport.send({ id, error: { code: "invalidParams", message: "Malformed request" } });
				return;
			}
			this.transport.send({ method: "error", params: { message: "Malformed message" } });
			return;
		}
		const envelope = message as Message;
		if ("method" in envelope && "id" in envelope) {
			if (this.inputEnded) {
				this.transport.send({
					id: envelope.id,
					error: { code: "shuttingDown", message: "the app server is shutting down" },
				});
				return;
			}
			const work = this.handleRequest(envelope.id, envelope.method, envelope.params);
			this.dispatching.add(work);
			void work.finally(() => {
				this.dispatching.delete(work);
				this.closeWhenAnswered();
			});
			return;
		}
		if ("method" in envelope) return this.handleNotification(envelope.method, envelope.params);
		const pending = this.outgoing.get(envelope.id);
		if (!pending) return;
		this.outgoing.delete(envelope.id);
		if ("error" in envelope)
			pending.reject(new AppServerError(envelope.error.code, envelope.error.message, envelope.error.data));
		else if (check(pending.resultSchema, envelope.result)) pending.resolve(envelope.result);
		else pending.reject(new AppServerError("invalidParams", "Malformed result"));
	}

	private handleNotification(method: string, params: unknown): void {
		if (this.inputEnded || this.state === "closed") return;
		if (
			!Object.hasOwn(ClientNotifications, method) ||
			!check(ClientNotifications[method as keyof typeof ClientNotifications], params)
		) {
			this.transport.send({ method: "error", params: { message: `Invalid notification: ${method}` } });
			return;
		}
		if (method === "initialized" && this.state === "initializing") {
			this.state = "ready";
			this.options.onInitialized?.(this);
		}
	}

	private async handleRequest(id: RequestId, method: string, params: unknown): Promise<void> {
		let settle!: () => void;
		const shutdown = new Promise<never>((_resolve, reject) => {
			settle = () => reject(new AppServerError("shuttingDown", "the request could not finish before shutdown"));
		});
		this.unfinishedAnswers.add(settle);
		try {
			const value = await Promise.race([this.dispatch(method, params), shutdown]);
			if (this.state === "closed") return;
			// A commit runs in the same synchronous step as the send (§4.5); a closed connection never runs it.
			const result = value instanceof Commit ? value.run() : value;
			this.transport.send({ id, result });
		} catch (error) {
			if (this.state === "closed") return;
			const failure =
				error instanceof AppServerError
					? { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) }
					: { code: "internal" as const, message: error instanceof Error ? error.message : String(error) };
			this.transport.send({ id, error: failure });
		} finally {
			this.unfinishedAnswers.delete(settle);
		}
	}

	private async dispatch(method: string, params: unknown): Promise<unknown> {
		if (!Object.hasOwn(ClientRequests, method)) throw new AppServerError("methodNotFound", `unknown method: ${method}`);
		const schemas = ClientRequests[method as ClientMethod];
		if (!check(schemas.params, params)) throw new AppServerError("invalidParams", `invalid params for ${method}`);
		if (method === "initialize") return this.initialize(params as ParamsOf<"initialize">);
		if (this.state !== "ready") throw new AppServerError("notInitialized", "send initialize and initialized first");
		const handler = this.options.handlers[method as ClientMethod] as
			((params: unknown, connection: AppServer) => Promise<unknown>) | undefined;
		if (!handler) throw new AppServerError("methodNotFound", `${method} is not available`);
		return handler(params, this);
	}

	private initialize(params: ParamsOf<"initialize">): ResultOf<"initialize"> {
		if (this.state !== "new") throw new AppServerError("invalidParams", "already initialized");
		this.optedOut = new Set(params.capabilities.optOutNotifications ?? []);
		this.state = "initializing";
		return {
			serverInfo: { name: "knightcode", version: this.options.version },
			platform: { os: process.platform as "win32" | "darwin" | "linux", arch: arch(), homeDir: homedir() },
		};
	}
}
