import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { braveSearch, tavilySearch, resolveSearchClient } from "./providers";
import { execute, filterResultsByDomains } from "./execute";

// --- fetch mocking helpers ---------------------------------------------------
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }>;

function mockFetch(jsonBody: unknown, ok = true, status = 200) {
  calls = [];
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: unknown,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init });
    return {
      ok,
      status,
      json: async () => jsonBody,
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
});

describe("braveSearch", () => {
  test("maps Brave web results to the normalized shape and sends the key header", async () => {
    mockFetch({
      web: {
        results: [
          { title: "Bun", url: "https://bun.sh", description: "Fast runtime" },
          { url: "https://example.com" }, // missing title/description
        ],
      },
    });

    const results = await braveSearch("brave-key", "bun runtime", 5);

    expect(results).toEqual([
      { title: "Bun", url: "https://bun.sh", snippet: "Fast runtime" },
      { title: "https://example.com", url: "https://example.com", snippet: "" },
    ]);
    expect(calls).toHaveLength(1);
    const reqUrl = new URL(calls[0]!.url);
    expect(reqUrl.searchParams.get("q")).toBe("bun runtime");
    expect(reqUrl.searchParams.get("count")).toBe("5");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe("brave-key");
  });

  test("throws on a non-ok response", async () => {
    mockFetch({}, false, 401);
    await expect(braveSearch("bad", "q", 5)).rejects.toThrow("HTTP 401");
  });
});

describe("tavilySearch", () => {
  test("maps Tavily results and POSTs the query with a Bearer key", async () => {
    mockFetch({
      results: [
        { title: "Zod", url: "https://zod.dev", content: "TS schema lib" },
        { url: "https://no-title.dev" },
      ],
    });

    const results = await tavilySearch("tav-key", "zod schema", 3);

    expect(results).toEqual([
      { title: "Zod", url: "https://zod.dev", snippet: "TS schema lib" },
      { title: "https://no-title.dev", url: "https://no-title.dev", snippet: "" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.tavily.com/search");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tav-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "zod schema",
      max_results: 3,
    });
  });

  test("throws on a non-ok response", async () => {
    mockFetch({}, false, 429);
    await expect(tavilySearch("bad", "q", 5)).rejects.toThrow("HTTP 429");
  });

  test("caps max_results at the provider maximum of 20", async () => {
    mockFetch({ results: [] });
    await tavilySearch("k", "q", 25);
    const body = JSON.parse(calls[0]!.init!.body as string) as {
      max_results: number;
    };
    expect(body.max_results).toBe(20);
  });
});

describe("resolveSearchClient", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-search-"));
    process.env.KNIGHTCODE_HOME = home;
    delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
    delete process.env.KNIGHTCODE_SEARCH_API_KEY;
  });

  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
    delete process.env.KNIGHTCODE_SEARCH_API_KEY;
    rmSync(home, { recursive: true, force: true });
  });

  test("returns null when no provider/key is configured", () => {
    expect(resolveSearchClient()).toBeNull();
  });

  test("returns null when a provider is set but the key is missing", () => {
    process.env.KNIGHTCODE_SEARCH_PROVIDER = "brave";
    expect(resolveSearchClient()).toBeNull();
  });

  test("returns null when a key is set but the provider is missing", () => {
    process.env.KNIGHTCODE_SEARCH_API_KEY = "k";
    expect(resolveSearchClient()).toBeNull();
  });

  test("resolves a brave client from env", () => {
    process.env.KNIGHTCODE_SEARCH_PROVIDER = "brave";
    process.env.KNIGHTCODE_SEARCH_API_KEY = "k";
    expect(resolveSearchClient()?.provider).toBe("brave");
  });

  test("resolves a tavily client from env", () => {
    process.env.KNIGHTCODE_SEARCH_PROVIDER = "tavily";
    process.env.KNIGHTCODE_SEARCH_API_KEY = "k";
    expect(resolveSearchClient()?.provider).toBe("tavily");
  });
});

describe("filterResultsByDomains", () => {
  const rows = [
    { title: "a", url: "https://docs.example.com/x", snippet: "" },
    { title: "b", url: "https://evil.test/y", snippet: "" },
    { title: "c", url: "not a url", snippet: "" },
  ];

  test("with no filters keeps every parseable url and drops bad urls", () => {
    expect(filterResultsByDomains(rows).map((r) => r.title)).toEqual(["a", "b"]);
  });

  test("allowed_domains is an allowlist that matches subdomains", () => {
    expect(
      filterResultsByDomains(rows, ["example.com"]).map((r) => r.title),
    ).toEqual(["a"]);
  });

  test("blocked_domains is a denylist", () => {
    expect(
      filterResultsByDomains(rows, undefined, ["evil.test"]).map((r) => r.title),
    ).toEqual(["a"]);
  });

  test("allowed_domains does not match a domain that merely contains the filter string", () => {
    const r = [{ title: "x", url: "https://notexample.com/", snippet: "" }];
    expect(filterResultsByDomains(r, ["example.com"])).toHaveLength(0);
  });
});

describe("execute", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-exec-"));
    process.env.KNIGHTCODE_HOME = home;
    delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
    delete process.env.KNIGHTCODE_SEARCH_API_KEY;
  });

  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
    delete process.env.KNIGHTCODE_SEARCH_API_KEY;
    rmSync(home, { recursive: true, force: true });
  });

  test("degrades gracefully when no key is configured", async () => {
    const out = (await execute({ query: "anything" })) as {
      error: string;
      results: unknown[];
    };
    expect(out.results).toEqual([]);
    expect(out.error).toContain("not configured");
  });

  test("degrades gracefully when the search call throws", async () => {
    process.env.KNIGHTCODE_SEARCH_PROVIDER = "brave";
    process.env.KNIGHTCODE_SEARCH_API_KEY = "k";
    mockFetch({}, false, 503); // braveSearch throws "Brave search failed: HTTP 503"

    const out = (await execute({ query: "qq" })) as {
      error: string;
      results: unknown[];
    };
    expect(out.results).toEqual([]);
    expect(out.error).toContain("brave");
    expect(out.error).toContain("503");
  });

  test("returns capped, provider-tagged results on the happy path", async () => {
    process.env.KNIGHTCODE_SEARCH_PROVIDER = "brave";
    process.env.KNIGHTCODE_SEARCH_API_KEY = "k";
    mockFetch({
      web: {
        results: [
          { title: "1", url: "https://a.com", description: "" },
          { title: "2", url: "https://b.com", description: "" },
          { title: "3", url: "https://c.com", description: "" },
        ],
      },
    });

    const out = (await execute({ query: "qq", max_results: 2 })) as {
      provider: string;
      results: unknown[];
    };
    expect(out.provider).toBe("brave");
    expect(out.results).toHaveLength(2);
  });

  test("rejects specifying both allowed_domains and blocked_domains", async () => {
    await expect(
      execute({
        query: "qq",
        allowed_domains: ["a.com"],
        blocked_domains: ["b.com"],
      }),
    ).rejects.toThrow("Cannot specify both");
  });
});
