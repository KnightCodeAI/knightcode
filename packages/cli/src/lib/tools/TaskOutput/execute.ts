import { TaskOutput, type KnightcodeTool } from "@knightcode/shared";
import { getTaskOutput } from "../task-store";

export const tool: KnightcodeTool = TaskOutput;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { task_id, tail } = TaskOutput.input_schema.parse(input);
  const output = await getTaskOutput(ctx.executionRoot, task_id, tail);
  return { task_id, output, count: output.length };
}
