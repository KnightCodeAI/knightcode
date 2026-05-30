import { ExitPlanMode, type KnightcodeTool } from "@knightcode/shared";

export const tool: KnightcodeTool = ExitPlanMode;

export async function execute(input: unknown): Promise<unknown> {
  const { plan } = ExitPlanMode.input_schema.parse(input);
  return {
    success: true,
    modeTransition: "BUILD" as const,
    plan: plan ?? null,
    message:
      "Plan submitted for user approval. Waiting for user to review and approve before proceeding with implementation.",
  };
}
