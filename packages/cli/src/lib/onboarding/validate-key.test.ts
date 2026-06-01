import { describe, expect, test } from "bun:test";
import { validateOpenRouterKey } from "./validate-key";

describe("validateOpenRouterKey", () => {
  test("200 response → valid, and sends a Bearer auth header", async () => {
    let sentAuth: string | null = null as string | null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentAuth = new Headers(init?.headers).get("Authorization");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await validateOpenRouterKey("sk-or-good", fetchImpl);
    expect(result.status).toBe("valid");
    expect(sentAuth).toBe("Bearer sk-or-good");
  });

  test("401 → invalid", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 401 })) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("sk-or-bad", fetchImpl);
    expect(result.status).toBe("invalid");
  });

  test("500 → error mentioning the status", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 500 })) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("sk-or-x", fetchImpl);
    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
  });

  test("network throw → error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("sk-or-x", fetchImpl);
    expect(result.status).toBe("error");
    expect(result.message).toContain("ECONNREFUSED");
  });

  test("empty/whitespace key → invalid without calling fetch", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("   ", fetchImpl);
    expect(result.status).toBe("invalid");
    expect(called).toBe(false);
  });
});
