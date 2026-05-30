import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  plan: z
    .string()
    .optional()
    .describe(
      "Optional plan summary to surface in the approval UI. If omitted, the approval prompt uses the most recent assistant message as the plan.",
    ),
});

export const ExitPlanMode = defineTool({
  name: "ExitPlanMode",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: false,
  visibility: "plan_only",
  search_hint: "exit plan mode and request approval",
  input_schema,
  description: `Use this tool when you are in plan mode and have finished your plan and are ready for user approval.

When to Use:
- ONLY when the task requires planning the implementation steps of a task that requires writing code.
- Do NOT use this for research tasks where you're gathering information, searching files, or understanding the codebase.

Before Using:
- Ensure your plan is complete and unambiguous.
- If you have unresolved questions about requirements or approach, use AskUserQuestion first.
- Once your plan is finalized, use THIS tool to request approval.

IMPORTANT: Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" — that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.`,
});

export type ExitPlanModeInput = z.infer<typeof input_schema>;
