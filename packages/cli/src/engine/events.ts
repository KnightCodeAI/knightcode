/**
 * Engine event bus and its SSE route.
 *
 * One stream carries every engine event. v1 uses it for account and catalog
 * changes; the session and agent-manager events land on the same stream later
 * without reshaping the front door.
 */

import type { EngineRoute } from "./server.ts";

export type EngineEvent =
	{ type: "account.changed"; providerId: string; authenticated: boolean } | { type: "models.changed" };

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
