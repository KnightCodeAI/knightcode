/**
 * Permission gate, as an inline extension.
 *
 * The CLI has no permission system of its own: the only interception point
 * before a tool runs is the `tool_call` extension event, whose handler may
 * block the call. The engine registers one hidden inline extension per
 * session that turns that event into a client request and blocks when the
 * answer is anything but allow.
 */

import type { InlineExtension } from "../core/extensions/index.ts";
import { ClientRequestAborted, type ClientReply, type ClientRequests } from "./client-requests.ts";

/** Built-in tools that only read never ask; everything else does. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls"]);

export function needsPermission(toolName: string): boolean {
	return !READ_ONLY_TOOLS.has(toolName);
}

export function createPermissionExtension(sessionId: string, requests: ClientRequests): InlineExtension {
	const alwaysAllowed = new Set<string>();
	return {
		name: "engine-permissions",
		hidden: true,
		factory: (knightcode) => {
			knightcode.on("tool_call", async (event, ctx) => {
				if (!needsPermission(event.toolName) || alwaysAllowed.has(event.toolName)) return undefined;
				let reply: ClientReply;
				try {
					// The loop awaits this handler outright, so the request has to release itself
					// on abort or a cancelled turn never settles.
					reply = await requests.ask(
						sessionId,
						{ kind: "permission", toolCallId: event.toolCallId, toolName: event.toolName, input: event.input },
						ctx.signal,
					);
				} catch (error) {
					if (error instanceof ClientRequestAborted) return { block: true, reason: "Tool call cancelled" };
					throw error;
				}
				if (reply.kind !== "permission") return { block: true, reason: "Permission request failed" };
				if (reply.outcome === "allow_always") alwaysAllowed.add(event.toolName);
				if (reply.outcome === "allow_always" || reply.outcome === "allow_once") return undefined;
				return {
					block: true,
					reason: reply.outcome === "cancelled" ? "Tool call cancelled" : "The user rejected this tool call",
				};
			});
		},
	};
}
