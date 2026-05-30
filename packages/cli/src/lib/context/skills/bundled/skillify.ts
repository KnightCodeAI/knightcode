import { apiClient } from "../../../api-client";
import type { Skill } from "../../skills";

const SKILLIFY_PROMPT_TEMPLATE = `# Skillify

You are capturing this session's repeatable process as a reusable skill.

## Your Session Context

Here is the user's messages and steering during this session:
<user_messages>
{{userMessages}}
</user_messages>

## Your Task

1. **Suggest name & description**: Suggest a name and description for the skill. Ask the user to confirm or rename.
2. **Identify arguments & details**: Suggest arguments/parameters based on what was observed, and ask if the skill should be saved globally (\`~/.knightcode/skills/<name>/SKILL.md\`) or locally to this project (\`.knightcode/skills/<name>/SKILL.md\`).
3. **Draft steps & verification**: Outline the precise steps, success criteria, and verification plan.
4. **Generate & Save**: Write the final \`SKILL.md\` file to the chosen location.

Ensure the generated \`SKILL.md\` contains frontmatter following this format:
\`\`\`markdown
---
name: skill-name
description: "A one-line description"
when_to_use: "Use when the user wants to..."
allowed-tools:
  - "Bash"
arguments:
  - env
---
\`\`\`
`;

export const skillifySkill: Skill = {
  name: "skillify",
  description:
    "Capture this session's repeatable process into a reusable skill.",
  userInvocable: true,
  disableModelInvocation: true, // User-only invocation
  source: "bundled",
  dirPath: "",
  body: SKILLIFY_PROMPT_TEMPLATE,
  getDynamicBody: async (args, sessionId) => {
    let userMessagesText = "No session history available.";
    if (sessionId) {
      try {
        const res = await apiClient.sessions[":id"].$get({
          param: { id: sessionId },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.messages)) {
            const userMessages = data.messages
              .filter((m: any) => m.role === "user")
              .map((m: any) => {
                if (typeof m.parts === "string") return m.parts;
                if (Array.isArray(m.parts)) {
                  return m.parts
                    .filter((p: any) => p && p.type === "text")
                    .map((p: any) => p.text)
                    .join("\n");
                }
                return "";
              })
              .filter(Boolean);
            if (userMessages.length > 0) {
              userMessagesText = userMessages.join("\n\n---\n\n");
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch session messages for skillify:", err);
      }
    }

    let prompt = SKILLIFY_PROMPT_TEMPLATE.replace(
      "{{userMessages}}",
      userMessagesText,
    );
    if (args) {
      prompt += `\n\n## Additional User Instructions\n\n${args}`;
    }
    return prompt;
  },
};
