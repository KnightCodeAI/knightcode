/**
 * Recovery primitives for transient model-stream failures: classify retryable
 * errors, honor Retry-After, compute bounded exponential backoff, sleep
 * abortably, and a generic withRetry wrapper. query.ts uses the primitives
 * directly around the streaming round (it yields UI events mid-stream, so it
 * can't delegate through withRetry); withRetry is the reusable form for
 * non-yielding callers (e.g. the Phase E subagent loop).
 */

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/** True for transient network/stream/server errors worth retrying. Never true
 *  for an AbortError (a deliberate cancel) or a client (4xx-except-429) error. */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  };
  if (e.name === "AbortError") return false;

  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (RETRYABLE_STATUS.has(status)) return true;
    if (status >= 400 && status < 500) return false; // client errors don't retry
  }
  if (typeof e.code === "string" && RETRYABLE_CODES.has(e.code)) return true;

  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("terminated") ||
    msg.includes("socket") ||
    msg.includes("stream error") ||
    msg.includes("overloaded") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("429")
  );
}

/** Retry-After (seconds or HTTP-date) from an error's response headers, in ms. */
export function getRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    responseHeaders?: Record<string, string>;
    headers?: Record<string, string>;
  };
  const headers = e.responseHeaders ?? e.headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/** Backoff for `attempt` (0-based): Retry-After if present, else 500·2^attempt,
 *  both capped at 8s. */
export function backoffDelayMs(
  attempt: number,
  retryAfterMs?: number | null,
): number {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_DELAY_MS);
  }
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

/** Resolve after `ms`, or immediately if `signal` is/aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `fn(attempt)` with bounded retries on retryable errors. `delayForAttempt`
 * defaults to backoffDelayMs (override with `() => 0` in tests). `onRetry` fires
 * before each wait. Rethrows immediately on a non-retryable error, on abort, or
 * after `maxRetries` retries.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    maxRetries?: number;
    signal?: AbortSignal;
    delayForAttempt?: (attempt: number, retryAfterMs: number | null) => number;
    onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const delayFor = opts.delayForAttempt ?? backoffDelayMs;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (
        attempt >= maxRetries ||
        opts.signal?.aborted ||
        !isRetryableError(err)
      ) {
        throw err;
      }
      const delayMs = delayFor(attempt, getRetryAfterMs(err));
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs, opts.signal);
      // An abort during the backoff must not buy one more fn() call: re-check
      // after the (abortable) sleep and surface the last error instead.
      if (opts.signal?.aborted) throw err;
      attempt++;
    }
  }
}
