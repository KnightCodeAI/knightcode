import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticNumber } from "../primitives";

const input_schema = z.object({
  query: z
    .string()
    .describe(
      'Query to find deferred tools. Use "select:<tool_name>" (or "select:<a>,<b>,<c>") for direct selection by name, or use keywords to fuzzy-search by description and search hint.',
    ),
  max_results: semanticNumber(
    z.number().int().min(1).max(20).optional().default(5),
  ).describe("Maximum number of results to return (default: 5)"),
});

export const ToolSearch = defineTool({
  name: "ToolSearch",
  is_read_only: true,
  is_concurrency_safe: true,
  is_deferred: false,
  search_hint: "discover deferred tools and load their schemas",
  input_schema,
  description: `Fetch full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in <system-reminder> messages but their parameter schemas are not loaded by default — they cannot be invoked until you fetch them. ToolSearch matches a query against the deferred tool list and returns the matched tools' complete JSONSchema definitions. Once a tool's schema appears in the result, it is callable like any tool defined at the top of the prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name.
- "notebook jupyter" — keyword search, up to max_results best matches.
- "+slack send" — require "slack" in the name, rank by remaining terms.

This tool is the entry point for the deferred-tool catalog. It is always loaded.`,
});

export type ToolSearchInput = z.infer<typeof input_schema>;
