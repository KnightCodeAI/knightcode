import { WebSearch, type KnightcodeTool } from "@knightcode/shared";
import { apiClient } from "../../api-client";

export const tool: KnightcodeTool = WebSearch;

export async function execute(input: unknown): Promise<unknown> {
  const { query, max_results, allowed_domains, blocked_domains } =
    WebSearch.input_schema.parse(input);

  if (allowed_domains?.length && blocked_domains?.length) {
    throw new Error(
      "Cannot specify both allowed_domains and blocked_domains in the same request",
    );
  }

  const res = await apiClient.web.search.$post({
    json: {
      query,
      maxResults: max_results,
      ...(allowed_domains && { allowedDomains: allowed_domains }),
      ...(blocked_domains && { blockedDomains: blocked_domains }),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Web search failed: ${text}`);
  }
  return await res.json();
}
