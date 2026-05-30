import { TaskCreate, type KnightcodeTool } from "@knightcode/shared";
import { createTaskRecord } from "../task-store";

export const tool: KnightcodeTool = TaskCreate;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { subject, description, active_form, metadata } =
    TaskCreate.input_schema.parse(input);
  const task = await createTaskRecord(ctx.executionRoot, {
    subject,
    description,
    active_form,
    metadata,
  });
  return { task };
}
