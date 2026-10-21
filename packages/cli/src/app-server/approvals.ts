/**
 * The approval gate (§5.4): a hidden inline extension per thread.
 *
 * The CLI has no permission system; the only interception point before a
 * tool runs is the `tool_call` extension event, whose handler may block. The
 * gate turns that event into an `item/toolCall/requestApproval` request to a
 * subscriber and blocks on anything but accept.
 */

import { isAbsolute, relative, sep } from "node:path";
import {
	type ApprovalResult,
	ApprovalMode,
	type ServerRequestMethod,
	type ServerRequestParams,
	type ServerRequestResult,
} from "@knightcode/app-server-protocol";
import { Compile } from "typebox/compile";
import type { InlineExtension } from "../core/extensions/types.ts";
import type { SessionEntry } from "../core/session-manager.ts";
import { resolveToCwd } from "../core/tools/path-utils.ts";
import { commandPrefix, matchesPrefix } from "./command-prefix.ts";
import { SubscriberGone } from "./errors.ts";
import type { LoadedThread } from "./loaded-thread.ts";
import { CANCELLED_REASON, DECLINED_REASON } from "./transcript.ts";

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls", "ask_user", "submit_plan"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);
const isApprovalMode = Compile(ApprovalMode);

function shellOf(tool: string): "bash" | "powershell" | undefined {
	return tool === "bash" || tool === "powershell" ? tool : undefined;
}
function commandOf(input: unknown): string | undefined {
	const command = typeof input === "object" && input !== null ? (input as { command?: unknown }).command : undefined;
	return typeof command === "string" ? command : undefined;
}
function reasonFor(tool: string, input: unknown, cwd: string): string | undefined {
	if (!EDIT_TOOLS.has(tool)) return undefined;
	const path = typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
	if (typeof path !== "string") return undefined;
	const inside = relative(cwd, resolveToCwd(path, cwd));
	return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
		? "Writes outside this thread's workspace"
		: undefined;
}

export const APPROVAL_MODE_ENTRY = "knightcode.approvalMode";

export function needsApproval(mode: ApprovalMode, tool: string): boolean {
	if (mode === "fullAccess" || READ_ONLY_TOOLS.has(tool)) return false;
	return mode === "ask" || !EDIT_TOOLS.has(tool);
}

/**
 * The mode stored on the branch: the latest entry decides. A value that is not a mode restores as
 * `ask`, the most restrictive one, rather than letting a corrupt file widen access (§5.4).
 */
export function readApprovalMode(entries: readonly SessionEntry[]): ApprovalMode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== APPROVAL_MODE_ENTRY) continue;
		return isApprovalMode.Check(entry.data) ? (entry.data as ApprovalMode) : "ask";
	}
	return undefined;
}

/**
 * Ask the subscriber that most recently started a turn, then the others. A
 * subscriber that disconnects or unsubscribes passes the question on; with
 * nobody left, or on abort, the answer is undefined (§4.5). Each attempt is
 * recorded in `thread.asks` with its target, so `withdrawFrom` can take it back.
 */
export async function askSubscribers<M extends ServerRequestMethod>(
	thread: LoadedThread,
	method: M,
	params: ServerRequestParams<M>,
	signal: AbortSignal,
): Promise<ServerRequestResult<M> | undefined> {
	const token = {};
	thread.openRequests.set(token, method === "item/toolCall/requestApproval" ? "approval" : "dialog");
	if (thread.openRequests.size === 1) thread.broadcastStatus();
	try {
		const tried = new Set<unknown>();
		for (;;) {
			const candidates = [thread.lastTurnSubscriber, ...thread.subscribers].filter(
				(s): s is NonNullable<typeof s> => s !== undefined && thread.subscribers.has(s) && !tried.has(s),
			);
			const target = candidates[0];
			if (!target || signal.aborted) return undefined;
			tried.add(target);
			// The attempt's own controller: aborted by the request's signal, or by withdrawFrom(target).
			const attempt = new AbortController();
			const forward = () => attempt.abort(signal.reason);
			signal.addEventListener("abort", forward, { once: true });
			const ask = { target, controller: attempt };
			thread.asks.add(ask);
			try {
				return await target.request(method, params, attempt.signal);
			} catch (error) {
				if (signal.aborted) return undefined;
				if (error instanceof SubscriberGone) continue;
				throw error;
			} finally {
				thread.asks.delete(ask);
				signal.removeEventListener("abort", forward);
			}
		}
	} finally {
		thread.openRequests.delete(token);
		if (thread.openRequests.size === 0) thread.broadcastStatus();
	}
}

export function createApprovalExtension(holder: { thread?: LoadedThread }): InlineExtension {
	return {
		name: "app-server-approvals",
		hidden: true,
		factory: (knightcode) => {
			knightcode.on("tool_call", async (event, ctx) => {
				const thread = holder.thread;
				if (!thread || !needsApproval(thread.approvalMode, event.toolName) || thread.allowed.has(event.toolName)) {
					return undefined;
				}
				const shell = shellOf(event.toolName);
				const command = shell ? commandOf(event.input) : undefined;
				if (
					shell &&
					command &&
					[...(thread.allowedPrefixes.get(shell) ?? [])].some((prefix) => matchesPrefix(command, prefix, shell))
				)
					return undefined;
				const prefix = shell && command ? commandPrefix(command, shell) : undefined;
				const reason = reasonFor(event.toolName, event.input, thread.session.sessionManager.getCwd());
				const decisions: ServerRequestParams<"item/toolCall/requestApproval">["decisions"] = ["accept"];
				if (!shell) decisions.push("acceptForSession");
				if (prefix) decisions.push("acceptPrefixForSession");
				decisions.push("decline");
				// The loop awaits this handler, so the request must release itself on abort.
				const controller = new AbortController();
				const onAbort = () => controller.abort();
				ctx.signal?.addEventListener("abort", onAbort, { once: true });
				if (ctx.signal?.aborted) onAbort();
				thread.pending.add(controller);
				let result: ApprovalResult;
				try {
					result = (await askSubscribers(
						thread,
						"item/toolCall/requestApproval",
						{
							threadId: thread.id,
							turnId: thread.mapper.currentTurnId() ?? "",
							itemId: event.toolCallId,
							tool: event.toolName,
							decisions,
							...(prefix ? { prefix } : {}),
							...(reason ? { reason } : {}),
							...thread.payloads.input(event.input),
							...(event.parentToolCallId ? { parentItemId: event.parentToolCallId } : {}),
						},
						controller.signal,
					)) ?? { decision: "cancel" };
				} finally {
					thread.pending.delete(controller);
					ctx.signal?.removeEventListener("abort", onAbort);
				}
				const offered = new Set<string>(decisions);
				const answer =
					result.decision === "cancel" || offered.has(result.decision) ? result : { decision: "decline" as const };
				if (answer.decision === "acceptForSession") thread.allowed.add(event.toolName);
				if (answer.decision === "acceptPrefixForSession" && shell && prefix) {
					const set = thread.allowedPrefixes.get(shell) ?? new Set<string>();
					set.add(prefix);
					thread.allowedPrefixes.set(shell, set);
				}
				if (
					answer.decision === "accept" ||
					answer.decision === "acceptForSession" ||
					answer.decision === "acceptPrefixForSession"
				)
					return undefined;
				const reasonText =
					answer.decision === "cancel"
						? CANCELLED_REASON
						: answer.decision === "decline" && answer.message
							? `${DECLINED_REASON}: ${answer.message}`
							: DECLINED_REASON;
				return { block: true, reason: reasonText };
			});
		},
	};
}
