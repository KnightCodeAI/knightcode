import { z } from "zod";
import { defineTool } from "../defineTool";

const todo_schema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "The imperative form describing what needs to be done (e.g. 'Run tests', 'Update schema')",
    ),
  active_form: z
    .string()
    .min(1)
    .describe(
      "The present continuous form shown during execution (e.g. 'Running tests', 'Updating schema')",
    ),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("Current status of the task"),
});

const input_schema = z.object({
  todos: z.array(todo_schema).describe("The updated todo list"),
});

export const TodoWrite = defineTool({
  name: "TodoWrite",
  is_read_only: false,
  is_concurrency_safe: true,
  search_hint: "update the session todo list",
  input_schema,
  description: `Update the todo list for the current session. Use proactively and often to track progress and pending tasks.

When to use:
- Task requires 3+ distinct steps or is complex non-trivial work
- User provides multiple tasks at once
- After receiving new instructions — update to reflect new scope
- When starting a task (mark in_progress), after completing it (mark completed)

When NOT to use:
- Single-step tasks completable in one tool call
- Purely conversational or informational exchanges
- Trivial tasks that can be completed in less than 3 steps

Rules:
- Only ONE item may be in_progress at a time.
- ONLY mark an item completed when it is FULLY done — not partially. Keep it in_progress if tests are failing or implementation is partial.
- Always provide both content (imperative: "Run tests") and active_form (present continuous: "Running tests") for each task.
- Mark tasks complete IMMEDIATELY after finishing (don't batch completions).
- Remove tasks that are no longer relevant.

TodoWrite is a per-session, ephemeral checklist. For persistent, multi-session work tracking, use the Task suite (TaskCreate, TaskList, TaskUpdate).`,
});

export type TodoWriteInput = z.infer<typeof input_schema>;
export type TodoItem = z.infer<typeof todo_schema>;
