import { TaskUpdate, type KnightcodeTool } from "@knightcode/shared";
import { updateTaskRecord } from "../task-store";

export const tool: KnightcodeTool = TaskUpdate;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const {
    task_id,
    subject,
    description,
    active_form,
    status,
    owner,
    add_blocks,
    add_blocked_by,
    metadata,
  } = TaskUpdate.input_schema.parse(input);

  const result = await updateTaskRecord(ctx.executionRoot, task_id, {
    subject,
    description,
    active_form,
    status,
    owner,
    add_blocks,
    add_blocked_by,
    metadata,
  });

  if ("deleted" in result) {
    return { success: true, deleted: true, task_id: result.id };
  }
  return { success: true, task: result };
}
