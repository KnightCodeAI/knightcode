/**
 * Models reachable through a gemini.google.com web session.
 *
 * The web app selects a model with a mode integer in `f.req[79]` and the same mode plus a hash in
 * `x-goog-ext-525001261-jspb`. Thinking is a separate menu code in `f.req[80]` and header slot 15:
 * low is 1, high is 2, medium is 4. These values come from the signed-in model catalog (hash at row
 * slot 0, mode at row slot 17) and are not ordered. Google renames them without notice; a rejected
 * selector comes back as protocol error 1052. An id missing from this table sends no selector, so
 * Gemini answers with the account default.
 */

export interface GeminiWebModelSelector {
	/** Mode written to `f.req[79]` and model-header slot 14. */
	mode: number;
	/** Hash written to model-header slot 4. */
	hash: string;
}

/** Keyed by KnightCode model id. `default` is intentionally absent. */
export const GEMINI_WEB_MODEL_SELECTORS: Record<string, GeminiWebModelSelector> = {
	"gemini-3.5-flash-lite": { mode: 6, hash: "8c46e95b1a07cecc" },
	"gemini-3.8-flash": { mode: 1, hash: "56fdd199312815e2" },
	"gemini-3.1-pro": { mode: 3, hash: "e6fa609c3fa255c0" },
	"gemini-4-argon": { mode: 8, hash: "95a4c0abcba24364" },
};

/**
 * Web-menu thinking codes. Not a scale: medium is 4, not 2, and 0 means "unset".
 * Keyed by KnightCode thinking level.
 */
export const GEMINI_WEB_THINKING_CODES = {
	low: 1,
	medium: 4,
	high: 2,
} as const;

export type GeminiWebThinkingLevel = keyof typeof GEMINI_WEB_THINKING_CODES;

export function geminiWebModelSelector(modelId: string | undefined): GeminiWebModelSelector | undefined {
	if (!modelId) return undefined;
	return GEMINI_WEB_MODEL_SELECTORS[modelId];
}

export function geminiWebThinkingCode(level: string | undefined): number | undefined {
	if (level === "low" || level === "medium" || level === "high") return GEMINI_WEB_THINKING_CODES[level];
	return undefined;
}
