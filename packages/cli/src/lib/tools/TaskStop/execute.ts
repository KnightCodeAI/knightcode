import { TaskStop, type KnightcodeTool } from "@knightcode/shared";
import { stopTaskRecord } from "../task-store";

export const tool: KnightcodeTool = TaskStop;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { task_id, reason } = TaskStop.input_schema.parse(input);
  const task = await stopTaskRecord(ctx.executionRoot, task_id, reason);
  return { success: true, task };
}
