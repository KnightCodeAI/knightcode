// Canonical user-facing text for an OpenRouter 429 (rate limit). Defined here
// as the single source of truth so the error formatter
// (services/api/errors.ts, which produces it) and the message renderer
// (components/messages/RateLimitMessage.tsx, which detects + displays it) agree
// without fragile string coupling.
//
// Under BYOK there is no hosted plan-reset surface or upsell — but OpenRouter
// does return 429s (notably on `:free` model variants and bursty usage), and
// withRetry can exhaust its retries on a persistent one, so the message still
// reaches the user.
export const RATE_LIMIT_MESSAGE = 'Rate limited — retrying after the reset window'

/**
 * True when an assistant error message is the OpenRouter rate-limit (429)
 * error. Matches the full canonical phrase rather than a loose substring so
 * normal model output that merely mentions "rate limit" is never mistaken for
 * the error (this runs against every assistant text block).
 */
export function isRateLimitErrorMessage(text: string): boolean {
  return text.includes(RATE_LIMIT_MESSAGE)
}
