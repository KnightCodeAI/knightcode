import { AskUserQuestion, type KnightcodeTool } from "@repo/shared";

export const tool: KnightcodeTool = AskUserQuestion;

/**
 * AskUserQuestion does not execute server-side or in the dispatcher — the UI
 * intercepts the tool call, renders the question(s), and supplies the user's
 * answer as the tool result. This stub exists only so the dispatcher has a
 * uniform shape; calling it directly is a bug.
 */
export async function execute(_input: unknown): Promise<never> {
  throw new Error(
    "AskUserQuestion is interactive — it must be answered through the UI, not executed directly.",
  );
}
