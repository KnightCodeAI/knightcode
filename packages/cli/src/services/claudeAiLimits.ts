// TODO: subscriber rate-limit tracking is account-backed and does not apply
// to a BYOK build; the types stay so the API layer ports unchanged, and the
// limit state is permanently 'allowed'.

type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

// Reason why overage is disabled/rejected
export type OverageDisabledReason =
  | 'overage_not_provisioned'
  | 'org_level_disabled'
  | 'org_level_disabled_until'
  | 'out_of_credits'
  | 'seat_tier_level_disabled'
  | 'member_level_disabled'
  | 'seat_tier_zero_credit_limit'
  | 'group_zero_credit_limit'
  | 'member_zero_credit_limit'
  | 'org_service_level_disabled'
  | 'org_service_zero_credit_limit'
  | 'no_limits_configured'
  | 'unknown'

export type ClaudeAILimits = {
  status: QuotaStatus
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: QuotaStatus
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

// Exported for parity with upstream consumers; permanently 'allowed'.
export const currentLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

export function extractQuotaStatusFromHeaders(_headers: Headers): void {}

export function extractQuotaStatusFromError(_error: unknown): void {}

export function getRateLimitErrorMessage(
  _limits: ClaudeAILimits,
  _model: string,
): string | null {
  return null
}

type RawWindowUtilization = {
  utilization: number // 0-1 fraction
  resets_at: number // unix epoch seconds
}
type RawUtilization = {
  five_hour?: RawWindowUtilization
  seven_day?: RawWindowUtilization
}

// TODO: unified rate-limit utilization is parsed from response headers; until
// the limits ledger is wired the statusline reads an empty window set.
export function getRawUtilization(): RawUtilization {
  return {}
}
