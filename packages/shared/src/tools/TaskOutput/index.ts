import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticNumber } from "../primitives";

const input_schema = z.object({
  task_id: z.string().describe("The ID of the task whose output to fetch"),
  tail: semanticNumber(z.number().int().positive().optional()).describe(
    "If set, return only the last N output entries. Otherwise return everything.",
  ),
});

export const TaskOutput = defineTool({
  name: "TaskOutput",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "fetch streamed output from a task",
  input_schema,
  description: `Fetch the streamed output / progress log for a task by ID. Useful for tasks that emit incremental updates as they run (e.g. background work or long-running scripts).

Returns the ordered list of output entries appended to the task since creation. Use \`tail\` to limit to the most recent entries.`,
});

export type TaskOutputInput = z.infer<typeof input_schema>;
