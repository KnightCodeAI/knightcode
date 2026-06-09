import { TaskGet, type KnightcodeTool } from "@repo/shared";
import { getTaskRecord } from "../task-store";

export const tool: KnightcodeTool = TaskGet;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { task_id } = TaskGet.input_schema.parse(input);
  const task = await getTaskRecord(ctx.executionRoot, task_id);
  if (!task) {
    return { found: false, task_id };
  }
  return { found: true, task };
}
