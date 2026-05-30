import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticBoolean } from "../primitives";

const input_schema = z.object({
  file_path: z.string().describe("Path to the file to modify"),
  old_string: z
    .string()
    .describe(
      "The text to replace. Must match the file exactly including whitespace and indentation. Must be unique in the file unless replace_all is true.",
    ),
  new_string: z
    .string()
    .describe(
      "The text to replace it with (must be different from old_string)",
    ),
  replace_all: semanticBoolean(z.boolean().optional().default(false)).describe(
    "Replace all occurrences of old_string (default false). Useful for renaming variables across a file.",
  ),
});

export const Edit = defineTool({
  name: "Edit",
  is_read_only: false,
  is_concurrency_safe: false,
  visibility: "build_only",
  search_hint: "exact-string edit a file",
  input_schema,
  description: `Performs exact string replacements in a file.

Usage:
- You MUST call Read at least once on this file before calling Edit. The edit will fail if you have not read the file.
- When editing text from Read output, preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. Never include any part of the line number prefix in old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER create new files unless explicitly required.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique, or use replace_all to change every instance.
- Use replace_all for replacing and renaming strings across the file (e.g., renaming a variable).
- For multiple edits to the same file, prefer MultiEdit to apply them atomically.
- Only use emojis if the user explicitly requests them.`,
});

export type EditInput = z.infer<typeof input_schema>;
