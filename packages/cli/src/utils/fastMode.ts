// TODO: fast mode is an account-backed serving tier; a BYOK build has no
// equivalent, so the mode is permanently off and cooldown handling is inert.

export type CooldownReason = 'rate_limit' | 'overloaded'

export function isFastModeEnabled(): boolean {
  return false
}

export function isFastModeAvailable(): boolean {
  return false
}

export function isFastModeCooldown(): boolean {
  return false
}

export function triggerFastModeCooldown(
  _resetTimestamp: number,
  _reason: CooldownReason,
): void {}

export function handleFastModeRejectedByAPI(): void {}

export function handleFastModeOverageRejection(_reason: string | null): void {}
