import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe(
      "The directory to search in. If not specified, the project root is used. Omit this field for the default — DO NOT pass the string 'undefined' or 'null'.",
    ),
});

export const Glob = defineTool({
  name: "Glob",
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "find files by glob pattern",
  input_schema,
  description: `Fast file pattern matching tool that works with any codebase size.

- ALWAYS use this tool instead of bash find commands.
- Supports glob patterns like "**/*.ts", "src/**/*.tsx".
- Returns matching file paths sorted by modification time (most recent first).
- Use this tool when you need to find files by name patterns.
- For content searches use Grep instead.`,
});

export type GlobInput = z.infer<typeof input_schema>;
