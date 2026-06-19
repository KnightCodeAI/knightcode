import { describe, it, expect } from "bun:test";
import {
  isRetryableError,
  getRetryAfterMs,
  backoffDelayMs,
  sleep,
  withRetry,
} from "./recovery";

describe("recovery primitives", () => {
  it("classifies transient errors as retryable", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("model is overloaded"))).toBe(true);
  });

  it("classifies non-transient errors as non-retryable", () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError(new Error("invalid api key"))).toBe(false);
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    expect(isRetryableError(aborted)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("reads Retry-After seconds from response headers", () => {
    expect(getRetryAfterMs({ responseHeaders: { "retry-after": "2" } })).toBe(2000);
    expect(getRetryAfterMs(new Error("x"))).toBeNull();
  });

  it("computes capped exponential backoff", () => {
    expect(backoffDelayMs(0)).toBe(500);
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(10)).toBe(8000); // capped
    expect(backoffDelayMs(0, 3000)).toBe(3000); // Retry-After wins
    expect(backoffDelayMs(0, 99999)).toBe(8000); // but still capped
  });

  it("sleep(0) resolves and a pre-aborted signal cuts a long sleep short", async () => {
    await sleep(0);
    const ctrl = new AbortController();
    ctrl.abort();
    const start = Date.now();
    await sleep(10000, ctrl.signal); // must return ~immediately, not after 10s
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("an abort DURING a sleep resolves it early", async () => {
    const ctrl = new AbortController();
    const start = Date.now();
    const pending = sleep(10000, ctrl.signal);
    ctrl.abort();
    await pending;
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("withRetry does not call fn again when aborted during backoff", async () => {
    let calls = 0;
    const ctrl = new AbortController();
    await expect(
      withRetry(
        async () => {
          calls++;
          // Abort mid-flight so the abort lands during the backoff sleep.
          ctrl.abort();
          throw { status: 503 };
        },
        { maxRetries: 5, signal: ctrl.signal, delayForAttempt: () => 0 },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(1); // no extra attempt after the cancel
  });

  it("withRetry retries a retryable failure then succeeds", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw { status: 503 };
        return "ok";
      },
      { maxRetries: 3, delayForAttempt: () => 0, onRetry: (i) => retries.push(i.attempt) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(retries).toEqual([1]);
  });

  it("withRetry gives up after maxRetries on persistent retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { status: 503 };
        },
        { maxRetries: 2, delayForAttempt: () => 0 },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("withRetry does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("invalid api key");
        },
        { maxRetries: 3, delayForAttempt: () => 0 },
      ),
    ).rejects.toThrow(/invalid api key/);
    expect(calls).toBe(1);
  });
});
