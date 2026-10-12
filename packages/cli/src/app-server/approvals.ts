/**
 * The approval gate (§5.4): a hidden inline extension per thread.
 *
 * The CLI has no permission system; the only interception point before a
 * tool runs is the `tool_call` extension event, whose handler may block. The
 * gate turns that event into an `item/toolCall/requestApproval` request to a
 * subscriber and blocks on anything but accept.
 */

import { type ApprovalDecision, ApprovalMode, type ServerRequestParams } from "@knightcode/app-server-protocol";
import { Compile } from "typebox/compile";
import type { InlineExtension } from "../core/extensions/types.ts";
import type { SessionEntry } from "../core/session-manager.ts";
import { SubscriberGone } from "./errors.ts";
import type { LoadedThread } from "./loaded-thread.ts";
import { CANCELLED_REASON, DECLINED_REASON } from "./transcript.ts";

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls", "ask_user", "submit_plan"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);
const isApprovalMode = Compile(ApprovalMode);

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
 * nobody left the answer is cancel (§4.5). Each attempt is recorded in
 * `thread.asks` with its target, so `withdrawFrom` can take it back.
 */
export async function askApproval(
	thread: LoadedThread,
	params: ServerRequestParams<"item/toolCall/requestApproval">,
	signal: AbortSignal,
): Promise<ApprovalDecision> {
	const tried = new Set<unknown>();
	for (;;) {
		const candidates = [thread.lastTurnSubscriber, ...thread.subscribers].filter(
			(s): s is NonNullable<typeof s> => s !== undefined && thread.subscribers.has(s) && !tried.has(s),
		);
		const target = candidates[0];
		if (!target || signal.aborted) return "cancel";
		tried.add(target);
		// The attempt's own controller: aborted by the request's signal, or by withdrawFrom(target).
		const attempt = new AbortController();
		const forward = () => attempt.abort(signal.reason);
		signal.addEventListener("abort", forward, { once: true });
		const ask = { target, controller: attempt };
		thread.asks.add(ask);
		try {
			return (await target.request("item/toolCall/requestApproval", params, attempt.signal)).decision;
		} catch (error) {
			if (signal.aborted) return "cancel";
			if (error instanceof SubscriberGone) continue;
			throw error;
		} finally {
			thread.asks.delete(ask);
			signal.removeEventListener("abort", forward);
		}
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
				// The loop awaits this handler, so the request must release itself on abort.
				const controller = new AbortController();
				const onAbort = () => controller.abort();
				ctx.signal?.addEventListener("abort", onAbort, { once: true });
				if (ctx.signal?.aborted) onAbort();
				thread.pending.add(controller);
				let decision: ApprovalDecision;
				try {
					decision = await askApproval(
						thread,
						{
							threadId: thread.id,
							turnId: thread.mapper.currentTurnId() ?? "",
							itemId: event.toolCallId,
							tool: event.toolName,
							...thread.payloads.input(event.input),
							...(event.parentToolCallId ? { parentItemId: event.parentToolCallId } : {}),
						},
						controller.signal,
					);
				} finally {
					thread.pending.delete(controller);
					ctx.signal?.removeEventListener("abort", onAbort);
				}
				if (decision === "acceptForSession") thread.allowed.add(event.toolName);
				if (decision === "accept" || decision === "acceptForSession") return undefined;
				return { block: true, reason: decision === "cancel" ? CANCELLED_REASON : DECLINED_REASON };
			});
		},
	};
}
