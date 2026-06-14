import type { Tip, TipContext } from './types.js'

// TODO: spinner tips — depends on the tip registry/history feature (not ported).
// With no registry wired, no tip is ever surfaced and the spinner shows none.

export async function getTipToShowOnSpinner(
  _context?: TipContext,
): Promise<Tip | undefined> {
  return undefined
}

export function recordShownTip(_tip: Tip): void {}
