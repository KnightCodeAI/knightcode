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
