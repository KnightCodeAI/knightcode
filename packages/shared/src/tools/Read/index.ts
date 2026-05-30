import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticNumber } from "../primitives";

const input_schema = z.object({
  file_path: z
    .string()
    .describe(
      "Path to the file to read. Relative to the project root, or absolute within the project.",
    ),
  offset: semanticNumber(z.number().int().nonnegative().optional()).describe(
    "Starting line number (0-indexed) for paginated reading. Only provide if the file is too large to read at once.",
  ),
  limit: semanticNumber(z.number().int().positive().optional()).describe(
    "Maximum number of lines to return (default 200). Only provide if the file is too large to read at once.",
  ),
  pages: z
    .string()
    .optional()
    .describe(
      'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.',
    ),
});

export const Read = defineTool({
  name: "Read",
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "read a file from the project",
  input_schema,
  description: `Reads a file from the project directory. Supports optional line-based pagination via offset and limit.

Usage:
- Always use this tool to read files — do NOT use bash cat, head, or tail.
- Results include line-number prefixes. Strip the prefix before using content as old_string in Edit — never include line numbers in old_string.
- By default reads up to 200 lines. For large files use offset + limit to paginate.
- This tool can read images (PNG, JPG, etc.) and returns them as base64 data.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs.
- This tool can read PDFs via the pages parameter (max 20 pages per call).
- Reading a directory or missing file returns an error.
- If you read a file that exists but has empty contents, you will receive a warning.`,
});

export type ReadInput = z.infer<typeof input_schema>;
