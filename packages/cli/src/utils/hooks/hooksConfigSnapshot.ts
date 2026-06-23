// Snapshot of the on-disk hooks configuration, captured once at startup so a
// live settings edit can be diffed against it and so the hooks-firing engine
// (utils/hooks.ts) has a stable per-event matcher list to run.
//
// KnightCode reads settings uncached (getSettingsForSource hits disk each call)
// and has no merged-settings snapshot, so hooks are merged here directly across
// the enabled sources rather than via getSettings_DEPRECATED().

import { getEnabledSettingSources } from '../settings/constants.js'
import type { SettingSource } from '../settings/constants.js'
import { isRestrictedToPluginOnly } from '../settings/pluginOnlyPolicy.js'
// Import as a module object so spyOn works in tests (direct imports bypass spies).
import * as settingsModule from '../settings/settings.js'
import type { HookEvent } from '../../types/hooks.js'
import type { HookMatcher, HooksSettings } from '../../schemas/hooks.js'

let initialHooksConfig: HooksSettings | null = null

// Concatenates each enabled source's per-event hook matchers into one config.
function mergeHooksFromSources(sources: readonly SettingSource[]): HooksSettings {
  const merged: HooksSettings = {}
  for (const source of sources) {
    const hooks = settingsModule.getSettingsForSource(source)?.hooks as
      | HooksSettings
      | undefined
    if (!hooks) continue
    for (const [event, matchers] of Object.entries(hooks)) {
      if (!matchers) continue
      const key = event as HookEvent
      ;(merged[key] ??= []).push(...(matchers as HookMatcher[]))
    }
  }
  return merged
}

// True if any non-managed enabled source sets disableAllHooks.
function disableAllHooksInNonManaged(): boolean {
  return getEnabledSettingSources()
    .filter(s => s !== 'policySettings')
    .some(s => settingsModule.getSettingsForSource(s)?.disableAllHooks === true)
}

/**
 * Get hooks from allowed sources, honoring the policy gates:
 * - policySettings.disableAllHooks → no hooks at all
 * - policySettings.allowManagedHooksOnly → only managed (policy) hooks
 * - strictPluginOnlyCustomization('hooks') → only managed hooks (plugin hooks
 *   are assembled separately in hooks.ts and unaffected here)
 * - disableAllHooks in a non-managed source → only managed hooks still run
 * Otherwise returns hooks merged from all enabled sources.
 */
function getHooksFromAllowedSources(): HooksSettings {
  const policySettings = settingsModule.getSettingsForSource('policySettings')

  if (policySettings?.disableAllHooks === true) {
    return {}
  }
  if (policySettings?.allowManagedHooksOnly === true) {
    return (policySettings.hooks as HooksSettings | undefined) ?? {}
  }
  if (isRestrictedToPluginOnly('hooks')) {
    return (policySettings?.hooks as HooksSettings | undefined) ?? {}
  }
  if (disableAllHooksInNonManaged()) {
    return (policySettings?.hooks as HooksSettings | undefined) ?? {}
  }
  return mergeHooksFromSources(getEnabledSettingSources())
}

/**
 * Whether only managed hooks should run. True when policy sets
 * allowManagedHooksOnly, or when a non-managed source sets disableAllHooks
 * (non-managed settings cannot disable managed hooks, so they become
 * managed-only).
 */
export function shouldAllowManagedHooksOnly(): boolean {
  const policySettings = settingsModule.getSettingsForSource('policySettings')
  if (policySettings?.allowManagedHooksOnly === true) {
    return true
  }
  if (
    disableAllHooksInNonManaged() &&
    policySettings?.disableAllHooks !== true
  ) {
    return true
  }
  return false
}

/**
 * Whether all hooks (including managed) should be disabled. Only true when
 * managed/policy settings set disableAllHooks.
 */
export function shouldDisableAllHooksIncludingManaged(): boolean {
  return (
    settingsModule.getSettingsForSource('policySettings')?.disableAllHooks ===
    true
  )
}

/** Capture the hooks config snapshot. Called once during startup. */
export function captureHooksConfigSnapshot(): void {
  initialHooksConfig = getHooksFromAllowedSources()
}

/** Re-capture the snapshot after hooks are modified via settings. */
export function updateHooksConfigSnapshot(): void {
  initialHooksConfig = getHooksFromAllowedSources()
}

/** Current hooks config from the snapshot, capturing lazily on first read. */
export function getHooksConfigFromSnapshot(): HooksSettings | null {
  if (initialHooksConfig === null) {
    captureHooksConfigSnapshot()
  }
  return initialHooksConfig
}

/** Reset the snapshot (testing). */
export function resetHooksConfigSnapshot(): void {
  initialHooksConfig = null
}
