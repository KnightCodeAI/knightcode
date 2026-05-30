import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  file_path: z.string().describe("Path to the file to write"),
  content: z.string().describe("The content to write to the file"),
});

export const Write = defineTool({
  name: "Write",
  is_read_only: false,
  is_concurrency_safe: false,
  visibility: "build_only",
  search_hint: "create or overwrite a file",
  input_schema,
  description: `Creates a new file or overwrites an existing one.

Usage:
- If the file already exists, you MUST read it with Read first. This tool will fail if you did not read the file first.
- Prefer Edit for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless the user explicitly asks for documentation.
- Only use emojis if the user explicitly requests them.`,
});

export type WriteInput = z.infer<typeof input_schema>;
