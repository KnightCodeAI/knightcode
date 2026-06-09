import { Skill, type KnightcodeTool } from "@repo/shared";

export const tool: KnightcodeTool = Skill;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string; sessionId: string },
): Promise<unknown> {
  const { skill, args } = Skill.input_schema.parse(input);
  const { loadSkill } = await import("../../context/skills");
  const loaded = loadSkill(skill, ctx.executionRoot);
  if (!loaded) {
    return {
      found: false,
      error: `No skill named "${skill}". Check the Available Skills index in the system prompt for the exact name.`,
    };
  }
  if (loaded.disableModelInvocation) {
    return {
      found: false,
      error: `Skill "${skill}" is user-only and cannot be invoked by the model.`,
    };
  }
  let bodyText = loaded.body;
  if (loaded.getDynamicBody) {
    try {
      bodyText = await loaded.getDynamicBody(args ?? "", ctx.sessionId);
    } catch (err) {
      console.error(`Failed to resolve dynamic body for skill ${skill}:`, err);
    }
  }
  return {
    found: true,
    name: loaded.name,
    description: loaded.description,
    args: args ?? null,
    instructions: bodyText,
  };
}
