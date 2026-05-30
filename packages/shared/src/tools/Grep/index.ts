import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticBoolean, semanticNumber } from "../primitives";

const input_schema = z.object({
  pattern: z
    .string()
    .describe("The regular expression pattern to search for in file contents"),
  path: z
    .string()
    .optional()
    .describe(
      "File or directory to search in. Defaults to the project root.",
    ),
  glob: z
    .string()
    .optional()
    .describe(
      'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") — maps to rg --glob',
    ),
  type: z
    .string()
    .optional()
    .describe(
      "File type to search (e.g. 'js', 'py', 'ts', 'go'). More efficient than glob for standard file types.",
    ),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .default("files_with_matches")
    .describe(
      "'content' shows matching lines (supports context flags, head_limit), 'files_with_matches' shows file paths (default, supports head_limit), 'count' shows match counts per file (supports head_limit).",
    ),
  "-i": semanticBoolean(z.boolean().optional()).describe(
    "Case insensitive search (rg -i)",
  ),
  "-n": semanticBoolean(z.boolean().optional()).describe(
    'Show line numbers in output (rg -n). Requires output_mode: "content". Defaults to true.',
  ),
  "-A": semanticNumber(z.number().int().nonnegative().optional()).describe(
    'Number of lines to show after each match (rg -A). Requires output_mode: "content".',
  ),
  "-B": semanticNumber(z.number().int().nonnegative().optional()).describe(
    'Number of lines to show before each match (rg -B). Requires output_mode: "content".',
  ),
  "-C": semanticNumber(z.number().int().nonnegative().optional()).describe(
    "Alias for context. Number of lines to show before and after each match.",
  ),
  context: semanticNumber(z.number().int().nonnegative().optional()).describe(
    'Number of lines to show before and after each match (rg -C). Requires output_mode: "content".',
  ),
  head_limit: semanticNumber(z.number().int().nonnegative().optional()).describe(
    'Limit output to first N lines/entries, equivalent to "| head -N". Defaults to 250. Pass 0 for unlimited (use sparingly — large result sets waste context).',
  ),
  offset: semanticNumber(z.number().int().nonnegative().optional()).describe(
    'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.',
  ),
  multiline: semanticBoolean(z.boolean().optional().default(false)).describe(
    "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
  ),
});

export const Grep = defineTool({
  name: "Grep",
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "search file contents with a regex",
  input_schema,
  description: `Search file contents with a regular expression under the project directory.

Usage:
- ALWAYS use this tool for content searches. NEVER invoke grep, rg, or ripgrep as a Bash command.
- Supports full regex syntax (e.g. "log.*Error", "function\\\\s+\\\\w+").
- Filter files with glob (e.g. "*.{ts,tsx}") or type (e.g. "js", "py", "rust"). type is more efficient for standard file types.
- Output modes: "files_with_matches" shows only file paths (default), "content" shows matching lines, "count" shows match counts.
- Pattern syntax: literal braces need escaping (use interface\\\\{\\\\} to find interface{} in Go code).
- Multiline matching: by default patterns match within single lines only. For cross-line patterns, use multiline: true.
- Use head_limit and offset for pagination of large result sets.`,
});

export type GrepInput = z.infer<typeof input_schema>;
