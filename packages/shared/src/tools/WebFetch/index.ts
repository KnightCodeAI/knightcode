import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticNumber } from "../primitives";

const input_schema = z.object({
  url: z.url().describe("The URL to fetch content from"),
  prompt: z
    .string()
    .describe(
      "Describes what information you want to extract from the page. The fetched content is summarized in light of this prompt.",
    ),
  max_length: semanticNumber(
    z.number().int().min(1).max(200_000).optional().default(20_000),
  ).describe("Maximum character length of returned text (default 20000)"),
});

export const WebFetch = defineTool({
  name: "WebFetch",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: true,
  search_hint: "fetch a URL and summarize it",
  input_schema,
  description: `Fetch a web page and return its content as plain text. Useful for reading documentation, articles, and web pages.

Usage notes:
- IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Check if the URL points to an authenticated service first.
- The URL must be a fully-formed valid URL. HTTP URLs will be automatically upgraded to HTTPS.
- Converts HTML to readable text/markdown automatically.
- The prompt parameter describes what information you want to extract from the page.
- For GitHub URLs, prefer using the gh CLI via Bash instead (e.g. gh pr view, gh issue view).
- Results may be summarized if the content is very large. Use max_length to limit response size.`,
});

export type WebFetchInput = z.infer<typeof input_schema>;
