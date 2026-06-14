// TODO: layered settings files (user/project/local) land with the settings
// phase; until then every read sees an empty settings object. The per-source
// path functions below are honest (they point at where each settings file
// will live) so the permission layer can classify settings paths today.

import { join, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import type { SettingSource } from './constants.js'

export function getSettingsRootPathForSource(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return resolve(getClaudeConfigHomeDir())
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
        '.claude',
        'settings.json',
      )
    case 'localSettings':
      return join(
        getSettingsRootPathForSource(source),
        '.claude',
        'settings.local.json',
      )
    case 'policySettings':
    case 'flagSettings':
      return undefined
  }
}

export type Settings = {
  alwaysThinkingEnabled?: boolean
  advisorModel?: string
  effortLevel?: 'low' | 'medium' | 'high' | 'max' | number
  outputStyle?: string
  /** Offer "clear context" when accepting a plan (plan-mode exit dialog). */
  showClearContextOnPlanAccept?: boolean
  [key: string]: unknown
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
    ? '.claude/settings.local.json'
    : '.claude/settings.json'
}
