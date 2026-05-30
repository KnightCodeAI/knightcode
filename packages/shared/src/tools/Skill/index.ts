import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  skill: z
    .string()
    .describe(
      "The skill name. Must match a name from the Available Skills index in the system prompt.",
    ),
  args: z
    .string()
    .optional()
    .describe(
      "Optional free-text arguments to pass to the skill. The skill body decides how to interpret them.",
    ),
});

export const Skill = defineTool({
  name: "Skill",
  is_read_only: true,
  is_concurrency_safe: false,
  search_hint: "load a skill on demand",
  input_schema,
  description: `Load a knightcode skill on demand. The Available Skills section of the system prompt lists every skill name and a one-line description — pick the closest match for what the user is asking and call this tool with that name.

When to use:
- User's request matches a skill description (e.g. user says "review the diff" and there's a "review" skill).
- You need reference instructions that the system prompt summarized but didn't include in full.
- Loading a workflow that takes side-effecting steps (verifying, deploying, releasing).

How to use:
- Pass the EXACT skill name from the index — no slash, no quotes.
- args is optional free-text. Most skills don't need it; pass the relevant identifier (issue number, PR number, file path) when the skill calls for one.
- The tool result is the skill's full instructions. After receiving it, FOLLOW the instructions verbatim — they override your default approach.

Do NOT call this tool to discover skills — the index is already in the system prompt. Do NOT call it speculatively for skills whose descriptions don't fit the current task.`,
});

export type SkillInput = z.infer<typeof input_schema>;
