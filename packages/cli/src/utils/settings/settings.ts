// TODO: layered settings files (user/project/local) land with the settings
// phase; until then every read sees an empty settings object. The per-source
// path functions below are honest (they point at where each settings file
// will live) so the permission layer can classify settings paths today.

import { join, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getKnightcodeConfigHomeDir } from '../envUtils.js'
import { readFileSync } from '../fileRead.js'
import { safeParseJSON } from '../json.js'
import type { SettingsJson } from './types.js'
import type { SettingSource } from './constants.js'

export function getSettingsRootPathForSource(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return resolve(getKnightcodeConfigHomeDir())
    case 'policySettings':
    case 'projectSettings':
    case 'localSettings':
    case 'flagSettings':
      return resolve(getOriginalCwd())
  }
}

export function getSettingsFilePathForSource(
  source: SettingSource,
): string | undefined {
  switch (source) {
    case 'userSettings':
      return join(getSettingsRootPathForSource(source), 'settings.json')
    case 'projectSettings':
      return join(
        getSettingsRootPathForSource(source),
        '.knightcode',
        'settings.json',
      )
    case 'localSettings':
      return join(
        getSettingsRootPathForSource(source),
        '.knightcode',
        'settings.local.json',
      )
    case 'policySettings':
    case 'flagSettings':
      return undefined
  }
}

// The loose settings document. Fields the partial models explicitly are kept;
// `effortLevel`/`statusLine` are left to the index signature so this stays
// assignable to the canonical (zod-inferred) SettingsJson — their concrete
// shapes there are narrower than the convenience types we used here.
export type Settings = {
  availableModels?: string[]
  alwaysThinkingEnabled?: boolean
  advisorModel?: string
  outputStyle?: string
  /** Offer "clear context" when accepting a plan (plan-mode exit dialog). */
  showClearContextOnPlanAccept?: boolean
  /** Welcome-screen company announcements (shown once per startup). */
  companyAnnouncements?: string[]
  /** Default --agent for the session (welcome footer / status). */
  agent?: string
  /** Project-scoped MCP server approval lists (read by the MCP config gate). */
  enabledMcpjsonServers?: string[]
  disabledMcpjsonServers?: string[]
  enableAllProjectMcpServers?: boolean
  [key: string]: any
}

export function getSettingsWithErrors(): {
  settings: Settings
  errors: unknown[]
} {
  return { settings: {}, errors: [] }
}

export function getInitialSettings(): Settings {
  return {}
}

// Alias kept for callers that read the merged settings snapshot directly.
export const getSettings_DEPRECATED = getInitialSettings

// TODO: auto-mode opt-in is part of the account-backed permission system; a BYOK
// build has no auto-mode, so the opt-in is permanently off.
export function hasAutoModeOptIn(): boolean {
  return false
}

// Settings file path relative to the project root, for display in the rule UI.
export function getRelativeSettingsFilePathForSource(
  source: 'projectSettings' | 'localSettings',
): string {
  return source === 'localSettings'
    ? '.knightcode/settings.local.json'
    : '.knightcode/settings.json'
}

// Reads and parses the settings file for a single source. Returns null when the
// source has no on-disk file (policySettings/flagSettings), the file is absent,
// or the contents are not valid JSON; returns {} for an empty file. Writes are
// still handled by updateSettingsForSource below.
export function getSettingsForSource(source: SettingSource): SettingsJson | null {
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) return null
  let content: string
  try {
    content = readFileSync(filePath)
  } catch {
    // File does not exist or is unreadable.
    return null
  }
  if (content.trim() === '') return {}
  const data = safeParseJSON(content, false)
  return data && typeof data === 'object' ? (data as SettingsJson) : null
}

export function updateSettingsForSource(
  _source: SettingSource,
  _settings: Settings,
): { error: Error | null } {
  return { error: null }
}

/**
 * Returns true if any trusted settings source has accepted the bypass
 * permissions mode dialog. projectSettings is intentionally excluded —
 * a malicious project could otherwise auto-bypass the dialog (RCE risk).
 */
export function hasSkipDangerousModePermissionPrompt(): boolean {
  return !!(
    getSettingsForSource('userSettings')?.skipDangerousModePermissionPrompt ||
    getSettingsForSource('localSettings')?.skipDangerousModePermissionPrompt ||
    getSettingsForSource('flagSettings')?.skipDangerousModePermissionPrompt ||
    getSettingsForSource('policySettings')?.skipDangerousModePermissionPrompt
  )
}

// TODO: managed/policy settings discovery is enterprise-only and out of scope.
export function getManagedFileSettingsPresence(): { hasBase: boolean; hasDropIns: boolean } {
  return { hasBase: false, hasDropIns: false }
}
export function getPolicySettingsOrigin(): 'remote' | 'plist' | 'hklm' | 'file' | 'hkcu' | null {
  return null
}
