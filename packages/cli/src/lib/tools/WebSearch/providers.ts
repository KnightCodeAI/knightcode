import {
  getSearchApiKey,
  getSearchProvider,
  type SearchProvider,
} from "../../credentials";

/** Normalized search hit returned to the agent (title + url + snippet). */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** A resolved, key-bearing client for one search provider. */
export interface SearchClient {
  provider: SearchProvider;
  search(query: string, maxResults: number): Promise<WebSearchResult[]>;
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_RESULTS = 20; // tool schema caps max_results at 20

export async function braveSearch(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(maxResults, MAX_PROVIDER_RESULTS)));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };
  return (data.web?.results ?? []).flatMap((r) =>
    typeof r.url === "string"
      ? [{ title: r.title ?? r.url, url: r.url, snippet: r.description ?? "" }]
      : [],
  );
}

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export async function tavilySearch(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const response = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(maxResults, MAX_PROVIDER_RESULTS),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Tavily search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? []).flatMap((r) =>
    typeof r.url === "string"
      ? [{ title: r.title ?? r.url, url: r.url, snippet: r.content ?? "" }]
      : [],
  );
}

/**
 * Build a client for the configured provider, or null when WebSearch is not
 * usable (no provider or no key). Both pieces are read from the credentials
 * layer, where env vars override the 0600 credentials file.
 */
export function resolveSearchClient(): SearchClient | null {
  const provider = getSearchProvider();
  const apiKey = getSearchApiKey();
  if (!provider || !apiKey) return null;
  if (provider === "brave") {
    return { provider, search: (q, n) => braveSearch(apiKey, q, n) };
  }
  return { provider, search: (q, n) => tavilySearch(apiKey, q, n) };
}
