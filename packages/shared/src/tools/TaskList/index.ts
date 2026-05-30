import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({});

export const TaskList = defineTool({
  name: "TaskList",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "list all tasks in the persistent task list",
  input_schema,
  description: `List all tasks in the persistent task list.

When to Use:
- To see what tasks are available to work on (status: 'pending', no owner, not blocked).
- To check overall progress on the project.
- To find tasks that are blocked and need dependencies resolved.
- After completing a task, to check for newly unblocked work or claim the next available task.
- Prefer working on tasks in ID order (lowest ID first) when multiple are available — earlier tasks often set up context for later ones.

Returns a summary of each task: id, subject, status, owner, blocked_by. Use TaskGet for full details including description and history.`,
});

export type TaskListInput = z.infer<typeof input_schema>;
