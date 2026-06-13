// TODO: the hooks-config snapshot (captures the on-disk hooks settings so a
// live settings change can diff against it) lands with the hooks subsystem.
// Inert today: no snapshot is captured and managed-hooks gating is off.

import type { HooksSettings } from '../settings/types.js'

export function shouldAllowManagedHooksOnly(): boolean {
  return false
}

export function shouldDisableAllHooksIncludingManaged(): boolean {
  return false
}

export function captureHooksConfigSnapshot(): void {}

export function updateHooksConfigSnapshot(): void {}

export function getHooksConfigFromSnapshot(): HooksSettings | null {
  return null
}

export function resetHooksConfigSnapshot(): void {}
