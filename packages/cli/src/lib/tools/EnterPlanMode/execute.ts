import { EnterPlanMode, type KnightcodeTool } from "@repo/shared";

export const tool: KnightcodeTool = EnterPlanMode;

export async function execute(input: unknown): Promise<unknown> {
  EnterPlanMode.input_schema.parse(input);
  return {
    success: true,
    modeTransition: "PLAN" as const,
    message:
      "Entered plan mode. Explore the codebase with read-only tools (Read, Grep, Glob), design an approach, and call ExitPlanMode when your plan is ready for user approval.",
  };
}
