import type * as React from 'react'
import { Box, Text } from '../../tui.js'
import { MessageResponse } from '../MessageResponse.js'

// OpenRouter rate-limit (429) message. There is no hosted plan-reset surface or
// upsell under BYOK, so this renders the error plus a short, actionable hint.
// `onOpenRateLimitOptions` is accepted for call-site compatibility but unused
// (no rate-limit options menu exists in the BYOK build).
export function RateLimitMessage({
  text,
}: {
  text: string
  onOpenRateLimitOptions?: () => void
}): React.ReactNode {
  // Drop the "API Error: " prefix so the line reads naturally.
  const message = text.replace(/^API Error:\s*/, '')
  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{message}</Text>
        <Text dimColor>
          · OpenRouter is rate-limiting requests — KnightCode retries
          automatically. If it persists, wait a moment or check your provider
          and credit limits.
        </Text>
      </Box>
    </MessageResponse>
  )
}

export function getUpsellMessage(
  _params: Record<string, unknown>,
): string | null {
  return null
}
