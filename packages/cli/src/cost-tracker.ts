// TODO: the session cost ledger lands with the statusline; until then the
// per-request cost passes through unaccumulated.

import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export function addToTotalSessionCost(
  cost: number,
  _usage: BetaUsage,
  _model: string,
): number {
  return cost
}

// TODO: the lines-changed ledger lands with the statusline; the file tools
// report edit sizes here, which currently pass through unaccumulated.
export function addToTotalLinesChanged(
  _additions: number,
  _removals: number,
): void {}

// TODO: the statusline reads these session totals off the cost ledger above,
// which is not accumulated yet — they report zero until the ledger is wired.
export function getTotalCost(): number {
  return 0
}

export function getTotalDuration(): number {
  return 0
}

export function getTotalAPIDuration(): number {
  return 0
}

export function getTotalInputTokens(): number {
  return 0
}

export function getTotalOutputTokens(): number {
  return 0
}

export function getTotalLinesAdded(): number {
  return 0
}

export function getTotalLinesRemoved(): number {
  return 0
}
