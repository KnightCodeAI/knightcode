import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  action: z
    .enum(["list", "get", "delete", "update"])
    .describe(
      "list: show saved memories (names + descriptions). get: read one memory's full body by name. delete: remove one by name. update: create or overwrite one.",
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Memory name/slug (the filename without .md). Required for delete and update. Use action:list (or the Memory Index in the system prompt) to get exact names.",
    ),
  description: z
    .string()
    .optional()
    .describe("One-line summary used for later recall (update only)."),
  type: z
    .enum(["user", "feedback", "project", "reference"])
    .optional()
    .describe("Memory type (update only)."),
  body: z.string().optional().describe("The memory content (update only)."),
});

export const Memory = defineTool({
  name: "Memory",
  is_read_only: false,
  is_concurrency_safe: false,
  search_hint: "list, delete, or update saved memories",
  input_schema,
  description: `Manage the auto-memory store — the persistent memories listed in the Memory Index of the system prompt. Use this when the user asks you to forget/remove, correct/change, or review what you remember. Memories survive across sessions; this tool is the only way to remove or correct them.

Actions:
- list: returns every saved memory (name, description, type). Use it to find exact names before get/delete/update.
- get: returns a memory's full body (the list only shows descriptions). Provide its exact \`name\`. Use before merging/rewriting so you don't lose content.
- delete: remove a memory. Provide its exact \`name\` (a kebab-case slug from list or the Memory Index).
- update: create or overwrite a memory. Provide \`name\`, \`type\` (user | feedback | project | reference), a one-line \`description\`, and the \`body\`.

Notes:
- Names are kebab-case slugs (the filename without .md).
- delete and update prompt the user for approval unless the session is in AUTO mode.
- Do not use this to save routine facts — those are captured automatically; use it for explicit forget/correct/review requests.`,
});

export type MemoryInput = z.infer<typeof input_schema>;
