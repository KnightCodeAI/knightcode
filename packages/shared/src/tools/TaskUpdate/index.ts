import { z } from "zod";
import { defineTool } from "../defineTool";

const status_schema = z.union([
  z.enum(["pending", "in_progress", "completed"]),
  z.literal("deleted"),
]);

const input_schema = z.object({
  task_id: z.string().describe("The ID of the task to update"),
  subject: z.string().optional().describe("New subject for the task"),
  description: z.string().optional().describe("New description for the task"),
  active_form: z
    .string()
    .optional()
    .describe(
      "Present continuous form shown in spinner when in_progress (e.g. 'Running tests')",
    ),
  status: status_schema
    .optional()
    .describe(
      "New status. Setting to 'deleted' permanently removes the task.",
    ),
  owner: z
    .string()
    .optional()
    .describe("New owner for the task (agent or user identifier)"),
  add_blocks: z
    .array(z.string())
    .optional()
    .describe("Task IDs that this task blocks"),
  add_blocked_by: z
    .array(z.string())
    .optional()
    .describe("Task IDs that block this task"),
  metadata: z
    .record(z.string(), z.unknown().nullable())
    .optional()
    .describe(
      "Metadata keys to merge into the task. Set a key to null to delete it.",
    ),
});

export const TaskUpdate = defineTool({
  name: "TaskUpdate",
  is_deferred: true,
  is_read_only: false,
  is_concurrency_safe: true,
  search_hint: "update an existing task",
  input_schema,
  description: `Update a task in the persistent task list.

Mark tasks as resolved:
- When you have completed the work described in a task.
- ALWAYS mark your assigned tasks as resolved when you finish them.

- ONLY mark a task as completed when you have FULLY accomplished it.
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress.
- When blocked, create a new task describing what needs to be resolved.
- Never mark a task as completed if tests are failing, implementation is partial, you encountered unresolved errors, or you couldn't find necessary files.

Delete tasks:
- Setting status to \`deleted\` permanently removes the task. Use when a task is no longer relevant or was created in error.

Status workflow: pending → in_progress → completed.

Staleness: read the task's latest state with TaskGet before updating it — other agents may have changed it.`,
});

export type TaskUpdateInput = z.infer<typeof input_schema>;
