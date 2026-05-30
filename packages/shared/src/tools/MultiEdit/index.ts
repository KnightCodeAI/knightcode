import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticBoolean } from "../primitives";

const edit_schema = z.object({
  old_string: z
    .string()
    .describe(
      "The text to replace. Must match the file exactly including whitespace and indentation. Must be unique unless replace_all is true.",
    ),
  new_string: z
    .string()
    .describe(
      "The text to replace it with (must be different from old_string)",
    ),
  replace_all: semanticBoolean(z.boolean().optional().default(false)).describe(
    "Replace all occurrences of old_string (default false)",
  ),
});

const input_schema = z.object({
  file_path: z.string().describe("Path to the file to modify"),
  edits: z
    .array(edit_schema)
    .min(1)
    .describe(
      "An ordered list of edits to apply sequentially to the same file. Each edit operates on the file state produced by the previous edits.",
    ),
});

export const MultiEdit = defineTool({
  name: "MultiEdit",
  is_read_only: false,
  is_concurrency_safe: false,
  visibility: "build_only",
  search_hint: "apply multiple edits to a file atomically",
  input_schema,
  description: `Performs multiple exact string replacements in a single file, applied sequentially and atomically.

Usage:
- You MUST call Read at least once on this file before calling MultiEdit.
- Edits are applied in order. Each edit sees the file state produced by all preceding edits in this call.
- If ANY edit in the list fails (old_string not found, ambiguous match without replace_all), the entire operation is rolled back — the file is left unchanged.
- Prefer MultiEdit over a sequence of Edit calls when you have multiple changes to the same file: it is atomic, faster, and reduces round-trips.
- All edits must be distinct. Two edits in the same call cannot have the same old_string unless replace_all is used.
- Only use emojis if the user explicitly requests them.`,
});

export type MultiEditInput = z.infer<typeof input_schema>;
export type MultiEditEdit = z.infer<typeof edit_schema>;
