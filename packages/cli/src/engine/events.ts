/**
 * Engine event bus and its SSE route.
 *
 * One stream carries every engine event. v1 uses it for account and catalog
 * changes; the session and agent-manager events land on the same stream later
 * without reshaping the front door.
 */

import type { ImageContent, TextContent } from "@knightcode/ai";
import type { ClientRequest } from "./client-requests.ts";
import type { EngineRoute } from "./server.ts";

export type ToolContent = TextContent | ImageContent;
export type TurnStopReason = "end_turn" | "max_tokens" | "cancelled" | "error";

export interface SessionUsage {
	/** Estimated tokens in context, or null right after a compaction. */
	used: number | null;
	size: number;
	/** Cumulative session cost in USD. */
	cost: number;
}

/**
 * One session's life on the bus. Every variant carries the session id, so a
 * subscriber that follows many sessions demultiplexes on it and one that
 * follows none ignores them all.
 */
export type SessionEvent =
	| { type: "session.created"; sessionId: string; cwd: string }
	| { type: "session.closed"; sessionId: string }
	| { type: "session.message"; sessionId: string; messageId: string }
	| { type: "session.delta"; sessionId: string; messageId: string; kind: "text" | "thinking"; delta: string }
	| { type: "session.tool_call"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
	| { type: "session.tool_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
	| {
			type: "session.tool_update";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			content: ToolContent[];
			details: unknown;
	  }
	| {
			type: "session.tool_end";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			content: ToolContent[];
			details: unknown;
			isError: boolean;
	  }
	| { type: "session.request"; sessionId: string; requestId: string; request: ClientRequest }
	| { type: "session.turn_end"; sessionId: string; stopReason: TurnStopReason; usage?: SessionUsage; error?: string };

export type EngineEvent =
	{ type: "account.changed"; providerId: string; authenticated: boolean } | { type: "models.changed" } | SessionEvent;

export interface EventBus {
	publish(event: EngineEvent): void;
	subscribe(listener: (event: EngineEvent) => void): () => void;
	subscriberCount(): number;
}

export function createEventBus(): EventBus {
	const listeners = new Set<(event: EngineEvent) => void>();
	return {
		publish(event) {
			// Snapshot first: a listener that subscribes or unsubscribes during
			// delivery must not change who receives the in-flight event.
			for (const listener of [...listeners]) {
				try {
					listener(event);
				} catch {
					// A broken subscriber must not stop delivery to the rest.
				}
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		subscriberCount: () => listeners.size,
	};
}

export function eventsRoute(bus: EventBus, heartbeatMs = 15_000): EngineRoute {
	return {
		method: "GET",
		path: "/events",
		handle: (req, res) => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				// Proxies that buffer would hold events until the response ends,
				// which for a stream is never.
				"x-accel-buffering": "no",
				"x-content-type-options": "nosniff",
			});
			res.write(": connected\n\n");

			const unsubscribe = bus.subscribe((event) => {
				res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			});
			const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), heartbeatMs);
			heartbeat.unref();

			let stopped = false;
			const stop = () => {
				if (stopped) return;
				stopped = true;
				clearInterval(heartbeat);
				unsubscribe();
			};
			req.on("close", stop);
			req.on("error", stop);
			res.on("close", stop);
			res.on("error", stop);
		},
	};
}
