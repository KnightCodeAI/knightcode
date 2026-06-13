// TODO: Anthropic rate-limit / usage-upsell UX is out of scope (BYOK has no
// hosted rate-limit surface). These render nothing / offer no upsell.
import type * as React from 'react'

export function RateLimitMessage(
  _props: Record<string, unknown>,
): React.ReactNode {
  return null
}

export function getUpsellMessage(_params: Record<string, unknown>): string | null {
  return null
}
