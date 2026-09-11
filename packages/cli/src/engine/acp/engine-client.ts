/**
 * The engine as the adapter sees it.
 *
 * The adapter is a client and nothing more: it holds no model, no credential
 * and no transcript. Everything it knows arrives through these calls and the
 * event stream. `events()` reconnects until its signal aborts; a drop fails
 * every turn in flight, because its `turn_end` may have been on the wire.
 */

import type { ClientFileCapabilities } from "../client-fs.ts";
import type { ClientReply } from "../client-requests.ts";
import type { EngineEvent } from "../events.ts";
import type { EngineModel } from "../models.ts";
import type { PromptInput, SessionSummary } from "../sessions.ts";

export class EngineRequestError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

export interface EngineClientOptions {
	baseUrl: string;
	token: string;
	reconnectDelayMs?: number;
}

export interface CreateSessionBody {
	cwd: string;
	model?: string;
	capabilities?: Partial<ClientFileCapabilities>;
}

export interface UpdateSessionBody {
	model?: string;
	thinkingLevel?: string;
}

export interface EventHandlers {
	onEvent(event: EngineEvent): Promise<void>;
	onDisconnect?(): void;
}

export interface EngineClient {
	models(): Promise<EngineModel[]>;
	createSession(body: CreateSessionBody): Promise<SessionSummary>;
	getSession(id: string): Promise<SessionSummary>;
	updateSession(id: string, body: UpdateSessionBody): Promise<SessionSummary>;
	prompt(id: string, input: PromptInput): Promise<void>;
	cancel(id: string): Promise<void>;
	reply(id: string, requestId: string, reply: ClientReply): Promise<void>;
	closeSession(id: string): Promise<void>;
	/** Consume /events until `signal` aborts, reconnecting after a drop. Events are handled one at a time, in order. */
	events(handlers: EventHandlers, signal: AbortSignal): Promise<void>;
}

function parseJson(text: string): unknown {
	if (text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

async function consume(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: EngineEvent) => Promise<void>,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let boundary = buffer.indexOf("\n\n");
		while (boundary >= 0) {
			const block = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			// Comments (heartbeats) have no data line and are skipped.
			const data = block
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice("data:".length).trim())
				.join("\n");
			if (data.length > 0) await onEvent(JSON.parse(data) as EngineEvent);
			boundary = buffer.indexOf("\n\n");
		}
	}
}

export function createEngineClient(options: EngineClientOptions): EngineClient {
	const headers = { authorization: `Bearer ${options.token}` };
	const reconnectDelayMs = options.reconnectDelayMs ?? 1000;

	async function call(method: string, path: string, body?: unknown): Promise<unknown> {
		const res = await fetch(`${options.baseUrl}${path}`, {
			method,
			headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const parsed = parseJson(await res.text());
		if (!res.ok) {
			const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
			throw new EngineRequestError(
				res.status,
				typeof record.error === "string" ? record.error : "error",
				typeof record.message === "string" ? record.message : `${method} ${path} failed with ${res.status}`,
			);
		}
		return parsed;
	}

	const session = (id: string) => `/v1/sessions/${encodeURIComponent(id)}`;

	return {
		models: async () => ((await call("GET", "/v1/models")) as { models: EngineModel[] }).models,
		createSession: (body) => call("POST", "/v1/sessions", body) as Promise<SessionSummary>,
		getSession: (id) => call("GET", session(id)) as Promise<SessionSummary>,
		updateSession: (id, body) => call("PATCH", session(id), body) as Promise<SessionSummary>,
		prompt: async (id, input) => {
			await call("POST", `${session(id)}/prompt`, input);
		},
		cancel: async (id) => {
			await call("POST", `${session(id)}/cancel`);
		},
		reply: async (id, requestId, reply) => {
			await call("POST", `${session(id)}/requests/${encodeURIComponent(requestId)}`, reply);
		},
		closeSession: async (id) => {
			await call("DELETE", session(id));
		},
		async events(handlers, signal) {
			while (!signal.aborted) {
				try {
					const res = await fetch(`${options.baseUrl}/events`, { headers, signal });
					if (!res.ok || !res.body) throw new EngineRequestError(res.status, "events", "event stream refused");
					await consume(res.body, handlers.onEvent);
				} catch {
					// A refused or dropped stream is retried below; an abort ends the loop.
				}
				if (signal.aborted) return;
				handlers.onDisconnect?.();
				await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
			}
		},
	};
}
