import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  task_id: z.string().describe("The ID of the task to stop"),
  reason: z
    .string()
    .optional()
    .describe("Optional short explanation of why the task is being stopped"),
});

export const TaskStop = defineTool({
  name: "TaskStop",
  is_deferred: true,
  is_read_only: false,
  is_concurrency_safe: true,
  search_hint: "stop an in-progress task",
  input_schema,
  description: `Stop a task that is currently in_progress. Sets status back to \`pending\` and clears the owner.

Use when:
- You realize a task is blocked and you need to surface it for replanning.
- You started a task by mistake and need to release it.

Prefer TaskUpdate({status: "completed"}) when work is genuinely done. Use TaskStop only when you are abandoning the in-progress attempt.`,
});

export type TaskStopInput = z.infer<typeof input_schema>;
