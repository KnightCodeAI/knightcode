import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  subject: z
    .string()
    .min(1)
    .describe("A brief, imperative-form title for the task (e.g. 'Fix login flow')"),
  description: z.string().min(1).describe("What needs to be done"),
  active_form: z
    .string()
    .optional()
    .describe(
      "Present continuous form shown in the spinner when the task is in_progress (e.g. 'Fixing login flow'). If omitted, the spinner shows the subject.",
    ),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Arbitrary key/value metadata to attach to the task"),
});

export const TaskCreate = defineTool({
  name: "TaskCreate",
  is_deferred: true,
  is_read_only: false,
  is_concurrency_safe: false,
  search_hint: "create a task in the persistent task list",
  input_schema,
  description: `Create a new task in the persistent task list. Tasks survive across messages in the session and are stored under .knightcode/tasks.json in the workspace.

Use TaskCreate (and the rest of the Task suite) when you need durable, multi-step work tracking that survives compaction, restarts, or hand-off — distinct from TodoWrite, which is an ephemeral per-session checklist.

When to Use:
- Complex multi-step tasks (3+ distinct steps).
- Plan mode — capture each step of the approved plan as a task.
- User provides multiple distinct deliverables.
- Anything you may need to revisit later in the same session or after compaction.

When NOT to Use:
- Single trivial action that can be done immediately.
- Pure conversation or one-shot information lookups.

Task Fields:
- subject: brief, actionable title in imperative form.
- description: what needs to be done.
- active_form: optional present-continuous form for spinner display.

All tasks are created with status \`pending\`. Use TaskUpdate to set status, owner, or dependencies after creation.`,
});

export type TaskCreateInput = z.infer<typeof input_schema>;
