import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  task_id: z.string().describe("The ID of the task to fetch"),
});

export const TaskGet = defineTool({
  name: "TaskGet",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "fetch full details for a task",
  input_schema,
  description: `Fetch the full details of a single task by ID. Returns subject, description, active_form, status, owner, blocks, blocked_by, metadata, created_at, and updated_at.

Use TaskGet to read the latest state of a task before calling TaskUpdate — concurrent updates from other agents may have changed the task since you last saw it.`,
});

export type TaskGetInput = z.infer<typeof input_schema>;
