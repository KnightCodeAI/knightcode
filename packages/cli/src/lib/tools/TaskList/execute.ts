import { TaskList, type KnightcodeTool } from "@repo/shared";
import { listTasksSummary } from "../task-store";

export const tool: KnightcodeTool = TaskList;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  TaskList.input_schema.parse(input);
  const tasks = await listTasksSummary(ctx.executionRoot);
  return { tasks };
}
