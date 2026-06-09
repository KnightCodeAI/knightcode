import { WebSearch, type KnightcodeTool } from "@repo/shared";
import { resolveSearchClient, type WebSearchResult } from "./providers";

export const tool: KnightcodeTool = WebSearch;

const NOT_CONFIGURED =
  "WebSearch is not configured. Set a search provider and key " +
  "(KNIGHTCODE_SEARCH_PROVIDER / KNIGHTCODE_SEARCH_API_KEY, or searchProvider / " +
  "searchApiKey in ~/.knightcode/credentials.json) to enable it; proceeding " +
  "without web search for now.";

/**
 * Keep results whose hostname satisfies the domain filters. `allowed` is an
 * allowlist (a result must match one entry); `blocked` is a denylist (a result
 * must match none). Matching is case-insensitive against the hostname or any
 * parent domain, so "example.com" matches "docs.example.com". Results with an
 * unparseable URL are dropped. Exported for unit testing (mirrors how
 * WebFetch/execute.ts exports isPrivateIp).
 */
export function filterResultsByDomains(
  results: WebSearchResult[],
  allowed?: string[],
  blocked?: string[],
): WebSearchResult[] {
  const norm = (d: string) => d.toLowerCase().replace(/^\*?\./, "");
  const allow = allowed?.map(norm);
  const block = blocked?.map(norm);
  return results.filter((r) => {
    let host: string;
    try {
      host = new URL(r.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    const matches = (d: string) => host === d || host.endsWith(`.${d}`);
    if (allow?.length && !allow.some(matches)) return false;
    if (block?.length && block.some(matches)) return false;
    return true;
  });
}

export async function execute(input: unknown): Promise<unknown> {
  const { query, allowed_domains, blocked_domains, max_results } =
    WebSearch.input_schema.parse(input);

  // Contract preserved from the prior stub: the two domain filters are mutually
  // exclusive (matches the reference TUI's WebSearch).
  if (allowed_domains?.length && blocked_domains?.length) {
    throw new Error(
      "Cannot specify both allowed_domains and blocked_domains in the same request",
    );
  }

  const client = resolveSearchClient();
  if (!client) {
    return { error: NOT_CONFIGURED, results: [] };
  }

  // Domain filtering happens after fetch, so over-fetch a little to still have
  // candidates to fill max_results (provider caps the count at 20).
  const hasFilter =
    Boolean(allowed_domains?.length) || Boolean(blocked_domains?.length);
  const fetchCount = hasFilter ? Math.min(max_results * 2, 20) : max_results;

  let raw: WebSearchResult[];
  try {
    raw = await client.search(query, fetchCount);
  } catch (err) {
    // Degrade rather than throw so the agent can proceed without web search.
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `WebSearch failed (${client.provider}): ${message}`,
      results: [],
    };
  }

  const filtered = filterResultsByDomains(raw, allowed_domains, blocked_domains);
  return {
    query,
    provider: client.provider,
    results: filtered.slice(0, max_results),
  };
}
