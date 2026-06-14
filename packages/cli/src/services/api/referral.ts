// TODO: the referral / guest-passes program is out of scope (account/billing).
// The welcome feed reads cached reward info to render a share prompt; with no
// account there is never a cached reward.

export type ReferrerRewardInfo = {
  currency: string
  amount_minor_units: number
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$' }

export function formatCreditAmount(reward: ReferrerRewardInfo): string {
  const symbol = CURRENCY_SYMBOLS[reward.currency] ?? `${reward.currency} `
  const amount = reward.amount_minor_units / 100
  const formatted = amount % 1 === 0 ? amount.toString() : amount.toFixed(2)
  return `${symbol}${formatted}`
}

export function getCachedReferrerReward(): ReferrerRewardInfo | null {
  return null
}
