// TODO: fast mode is an account-backed serving tier; a BYOK build has no
// equivalent, so the mode is permanently off and cooldown handling is inert.
import type { ModelSetting } from './model/model.js'

export type CooldownReason = 'rate_limit' | 'overloaded'

export function isFastModeEnabled(): boolean {
  return false
}

export function isFastModeAvailable(): boolean {
  return false
}

export function isFastModeSupportedByModel(_model: ModelSetting): boolean {
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

// Auto/fast mode is unavailable in a BYOK build; no reason string to surface.
export function getFastModeUnavailableReason(): string | null {
  return null
}

// Display label + model used for fast mode; cooldown is a no-op in a BYOK build.
export const FAST_MODE_MODEL_DISPLAY = 'Opus 4.6'
export function getFastModeModel(): string { return FAST_MODE_MODEL_DISPLAY }
export function clearFastModeCooldown(): void {}

// Tri-state fast-mode status surfaced in the init message. Always 'off' in a
// BYOK build since the underlying tier is never enabled.
export function getFastModeState(
  model: ModelSetting,
  fastModeUserEnabled: boolean | undefined,
): 'off' | 'cooldown' | 'on' {
  const enabled =
    isFastModeEnabled() &&
    isFastModeAvailable() &&
    !!fastModeUserEnabled &&
    isFastModeSupportedByModel(model)
  if (enabled && isFastModeCooldown()) {
    return 'cooldown'
  }
  if (enabled) {
    return 'on'
  }
  return 'off'
}
