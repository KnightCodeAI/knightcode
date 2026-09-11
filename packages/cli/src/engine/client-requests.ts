/**
 * Requests the engine makes of the client that owns a session.
 *
 * ACP inverts control for permissions and for the filesystem: the agent asks
 * the editor and the editor answers. The adapter that speaks ACP is a
 * separate process reached over HTTP, so the question goes out on the event
 * bus and the answer comes back as a POST. A parked request holds the tool
 * that asked until the answer lands, the turn is aborted, or the session
 * closes. This is the shape `createLoginRegistry` already uses for OAuth
 * prompts.
 */

import { randomUUID } from "node:crypto";
import type { EventBus } from "./events.ts";

export type PermissionOutcome = "allow_once" | "allow_always" | "reject_once" | "reject_always" | "cancelled";

export type ClientRequest =
	| { kind: "permission"; toolCallId: string; toolName: string; input: unknown }
	| { kind: "fs.read"; toolCallId?: string; path: string }
	| { kind: "fs.write"; toolCallId?: string; path: string; content: string };

export type ClientReply =
	| { kind: "permission"; outcome: PermissionOutcome }
	| { kind: "fs.read"; content: string }
	| { kind: "fs.write" }
	/** `not_found` means the client does not own that path; the engine falls back to local disk. */
	| { kind: "error"; code: "not_found" | "failed"; message: string };

export class ClientRequestAborted extends Error {}

export interface ClientRequests {
	/** Publish the request and park until it is answered or aborted. */
	ask(sessionId: string, request: ClientRequest, signal?: AbortSignal): Promise<ClientReply>;
	/** Deliver an answer. False when nothing is parked under that id. */
	reply(requestId: string, reply: ClientReply): boolean;
	/** Reject every parked request for a session. */
	abortAll(sessionId: string, reason: string): void;
	/** Test seam: how many requests are parked. */
	size(): number;
}

interface Parked {
	sessionId: string;
	resolve(reply: ClientReply): void;
	reject(error: Error): void;
	cleanup(): void;
}

export function createClientRequests(events: EventBus): ClientRequests {
	const parked = new Map<string, Parked>();

	function take(requestId: string): Parked | undefined {
		const entry = parked.get(requestId);
		if (!entry) return undefined;
		parked.delete(requestId);
		entry.cleanup();
		return entry;
	}

	return {
		ask(sessionId, request, signal) {
			if (signal?.aborted) return Promise.reject(new ClientRequestAborted("aborted"));
			const requestId = randomUUID();
			return new Promise<ClientReply>((resolve, reject) => {
				const onAbort = () => take(requestId)?.reject(new ClientRequestAborted("aborted"));
				signal?.addEventListener("abort", onAbort, { once: true });
				parked.set(requestId, {
					sessionId,
					resolve,
					reject,
					cleanup: () => signal?.removeEventListener("abort", onAbort),
				});
				// Parked first: a subscriber that answers synchronously must find it.
				events.publish({ type: "session.request", sessionId, requestId, request });
			});
		},
		reply(requestId, reply) {
			const entry = take(requestId);
			if (!entry) return false;
			entry.resolve(reply);
			return true;
		},
		abortAll(sessionId, reason) {
			for (const [requestId, entry] of [...parked]) {
				if (entry.sessionId !== sessionId) continue;
				take(requestId);
				entry.reject(new ClientRequestAborted(reason));
			}
		},
		size: () => parked.size,
	};
}
