const KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";
const TIMEOUT_MS = 10_000;

export type KeyValidationStatus = "valid" | "invalid" | "error";

export interface KeyValidationResult {
  status: KeyValidationStatus;
  /** Human-readable reason for "invalid"/"error"; absent for "valid". */
  message?: string;
}

/**
 * Check an OpenRouter key against GET /api/v1/key.
 *  - "valid":   HTTP 200 (key accepted).
 *  - "invalid": HTTP 401/403 (key rejected) or an empty key.
 *  - "error":   any other status or a network failure — the caller may let the
 *               user proceed anyway (e.g. offline), since this is advisory.
 * `fetchImpl` is injectable for tests; defaults to the global fetch.
 */
export async function validateOpenRouterKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyValidationResult> {
  if (!apiKey.trim()) {
    return { status: "invalid", message: "API key is empty." };
  }

  let response: Response;
  try {
    response = await fetchImpl(KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (response.ok) return { status: "valid" };
  if (response.status === 401 || response.status === 403) {
    return { status: "invalid", message: "OpenRouter rejected this key." };
  }
  return {
    status: "error",
    message: `OpenRouter returned HTTP ${response.status}.`,
  };
}
