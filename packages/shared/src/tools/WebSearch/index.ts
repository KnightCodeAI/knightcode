import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticNumber } from "../primitives";

const input_schema = z.object({
  query: z.string().min(2).describe("The search query to use"),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe(
      "Only include search results from these domains. Cannot be combined with blocked_domains.",
    ),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe(
      "Never include search results from these domains. Cannot be combined with allowed_domains.",
    ),
  max_results: semanticNumber(
    z.number().int().min(1).max(20).optional().default(5),
  ).describe("Maximum number of search results to return (default 5, max 20)"),
});

export const WebSearch = defineTool({
  name: "WebSearch",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "search the web",
  input_schema,
  description: `Search the web for information.

CRITICAL REQUIREMENT — You MUST follow this:
- After answering the user's question, you MUST include a "Sources:" section at the end of your response.
- In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL).
- This is MANDATORY — never skip including sources in your response.

Usage notes:
- Include the current month and year in time-sensitive queries (e.g. "best practices 2026").
- Domain filtering is supported via allowed_domains and blocked_domains — cannot use both at once.`,
});

export type WebSearchInput = z.infer<typeof input_schema>;
