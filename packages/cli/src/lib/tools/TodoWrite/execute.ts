import { TodoWrite, type KnightcodeTool } from "@knightcode/shared";

export const tool: KnightcodeTool = TodoWrite;

export async function execute(input: unknown): Promise<unknown> {
  const { todos } = TodoWrite.input_schema.parse(input);

  const inProgress = todos.filter((t) => t.status === "in_progress");
  if (inProgress.length > 1) {
    throw new Error(
      `Only one todo may be in_progress at a time. Found ${inProgress.length}.`,
    );
  }

  return {
    success: true as const,
    count: todos.length,
    pending: todos.filter((t) => t.status === "pending").length,
    in_progress: inProgress.length,
    completed: todos.filter((t) => t.status === "completed").length,
    todos,
  };
}
