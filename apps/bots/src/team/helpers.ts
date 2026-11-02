// Helpers (spec section 11): short-lived parallel workers a bot starts. Each shows as a card (Running, Completed,
// Failed). A helper is a child conversation owned by the tool call, with no memory or chat of its own and none of the
// bot-management or bot-messaging tools; it inherits the parent's provenance (section 24).
import { type Conversation, configure, defineTool, type ToolRegistration } from "@knightcode/durable";
import { obj, str } from "@knightcode/schema";
import { FLEET_TOOL_NAMES } from "./fleet.ts";

/** Tools a helper never gets: management, messaging other bots, starting more helpers, and memory writes. */
export const HELPER_EXCLUDED = new Set([...FLEET_TOOL_NAMES, "message_bot", "start_helper", "save_note", "update_bot"]);

/** The parent's tools a helper keeps. */
export const helperTools = (tools: readonly ToolRegistration[]) => tools.filter((tool) => !HELPER_EXCLUDED.has(tool.name));

export function startHelperTool(deps: { tools: () => readonly ToolRegistration[]; inherit(childKey: string): Promise<void> }) {
	return defineTool({
		name: "start_helper",
		description: "Hand a self-contained task to a short-lived helper and get its answer back.",
		parameters: obj({ task: str() }),
		replay: "safe",
		execute: async (args, api, context) => {
			const removed = deps.tools().filter((tool) => HELPER_EXCLUDED.has(tool.name));
			const childId = await api.commit(async (tx) => {
				// The ownership index remembers the child, so a rerun reuses it.
				const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
				if (existing !== undefined) return existing.id;
				const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
				await configure(tx, created.id, { tools: { remove: removed } });
				return created.id;
			}, context);
			await deps.inherit(String(childId));
			await api.details({ helper: String(childId), status: "running" }, context);
			const child = (await api.conversation(childId, context)) as Conversation;
			const submission = await child.submit({ type: "input", content: args.task, requestId: `helper:${api.taskId}` }, context);
			const settled = await submission.wait(context);
			await api.details({ helper: String(childId), status: settled.status === "done" ? "completed" : "failed" }, context);
			if (settled.status !== "done" || settled.type !== "input")
				return { output: [{ type: "text" as const, text: "The helper did not finish." }], isError: true };
			const answer = (await child.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, context)).items[0];
			const message = answer?.model?.[0] as { content?: { type: string; text?: string }[] } | undefined;
			const text = (message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("") || "(no answer)";
			return { output: [{ type: "text" as const, text }] };
		},
	});
}
