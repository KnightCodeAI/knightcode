// Layered settings: user / project / local files (+ file-based managed policy),
// merged in precedence order. Reads are validated against the settings schema;
// writes persist to the chosen source file. The enterprise/cloud policy sources
// (remote-managed, MDM/HKLM, HKCU) are out of scope for a BYOK build — only the
// file-based managed-settings.json + drop-ins are honored for policySettings.

import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import mergeWith from 'lodash-es/mergeWith.js'
import { dirname, join, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { uniq } from '../array.js'
import { getKnightcodeConfigHomeDir } from '../envUtils.js'
import { readFileSync } from '../fileRead.js'
import { safeParseJSON } from '../json.js'
import {
  getEnabledSettingSources,
  SETTING_SOURCES,
  type SettingSource,
} from './constants.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from './managedPath.js'
import { SettingsSchema, type SettingsJson } from './types.js'
import {
  filterInvalidPermissionRules,
  formatZodError,
  type SettingsWithErrors,
  type ValidationError,
} from './validation.js'

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

// ── Managed (file-based policy) settings ─────────────────────────────────────

function getManagedSettingsFilePath(): string {
  return join(getManagedFilePath(), 'managed-settings.json')
}

/**
 * Load file-based managed settings: managed-settings.json + managed-settings.d/
 * drop-ins. The base file is merged first (lowest precedence); drop-ins are
 * sorted alphabetically and merged on top (later files win), matching the
 * systemd/sudoers drop-in convention. Exported for testing.
 */
export function loadManagedFileSettings(): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  const errors: ValidationError[] = []
  let merged: SettingsJson = {}
  let found = false

  const base = parseSettingsFile(getManagedSettingsFilePath())
  errors.push(...base.errors)
  if (base.settings && Object.keys(base.settings).length > 0) {
    merged = mergeWith(merged, base.settings, settingsMergeCustomizer)
    found = true
  }

  const dropInDir = getManagedSettingsDropInDir()
  try {
    const entries = readdirSync(dropInDir, { withFileTypes: true })
      .filter(
        d =>
          (d.isFile() || d.isSymbolicLink()) &&
          d.name.endsWith('.json') &&
          !d.name.startsWith('.'),
      )
      .map(d => d.name)
      .sort()
    for (const name of entries) {
      const { settings, errors: fileErrors } = parseSettingsFile(
        join(dropInDir, name),
      )
      errors.push(...fileErrors)
      if (settings && Object.keys(settings).length > 0) {
        merged = mergeWith(merged, settings, settingsMergeCustomizer)
        found = true
      }
    }
  } catch {
    // Drop-in dir absent — managed policy is optional.
  }

  return { settings: found ? merged : null, errors }
}

/**
 * Check which file-based managed settings sources are present (for /status).
 */
export function getManagedFileSettingsPresence(): {
  hasBase: boolean
  hasDropIns: boolean
} {
  const { settings: base } = parseSettingsFile(getManagedSettingsFilePath())
  const hasBase = !!base && Object.keys(base).length > 0

  let hasDropIns = false
  try {
    hasDropIns = readdirSync(getManagedSettingsDropInDir(), {
      withFileTypes: true,
    }).some(
      d =>
        (d.isFile() || d.isSymbolicLink()) &&
        d.name.endsWith('.json') &&
        !d.name.startsWith('.'),
    )
  } catch {
    // dir doesn't exist
  }

  return { hasBase, hasDropIns }
}

export function getPolicySettingsOrigin():
  | 'remote'
  | 'plist'
  | 'hklm'
  | 'file'
  | 'hkcu'
  | null {
  // BYOK only honors the file-based managed source.
  return loadManagedFileSettings().settings ? 'file' : null
}

// ── Per-file parsing ─────────────────────────────────────────────────────────

/**
 * Parse + schema-validate a single settings file. Returns {settings:{}} for an
 * empty file, {settings:null} for missing/unreadable/invalid files. Invalid
 * permission rules are filtered out (with warnings) before validation so one bad
 * rule doesn't reject the whole file. Exported for testing.
 */
export function parseSettingsFile(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  let content: string
  try {
    content = readFileSync(path)
  } catch {
    return { settings: null, errors: [] }
  }
  if (content.trim() === '') return { settings: {}, errors: [] }

  const data = safeParseJSON(content, false)
  const ruleWarnings = filterInvalidPermissionRules(data, path)
  const result = SettingsSchema().safeParse(data)
  if (!result.success) {
    return {
      settings: null,
      errors: [...ruleWarnings, ...formatZodError(result.error, path)],
    }
  }
  return { settings: result.data, errors: ruleWarnings }
}

// Reads and parses the settings file for a single source. Returns null when the
// source has no on-disk file (policySettings/flagSettings), the file is absent,
// or the contents are invalid; returns {} for an empty file.
export function getSettingsForSource(
  source: SettingSource,
): SettingsJson | null {
  if (source === 'policySettings') return loadManagedFileSettings().settings
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) return null
  return parseSettingsFile(filePath).settings
}

// ── Merge customizer ─────────────────────────────────────────────────────────

function mergeArrays<T>(targetArray: T[], sourceArray: T[]): T[] {
  return uniq([...targetArray, ...sourceArray])
}

/**
 * lodash mergeWith customizer: arrays are concatenated + deduplicated, other
 * values use lodash's default deep-merge. Exported for testing.
 */
export function settingsMergeCustomizer(
  objValue: unknown,
  srcValue: unknown,
): unknown {
  if (Array.isArray(objValue) && Array.isArray(srcValue)) {
    return mergeArrays(objValue, srcValue)
  }
  return undefined
}

// ── Merged (effective) settings ──────────────────────────────────────────────

let sessionSettingsCache: SettingsWithErrors | null = null

// Invalidate the in-process merged-settings snapshot (after a write).
export function resetSettingsCache(): void {
  sessionSettingsCache = null
}

function loadSettingsFromDisk(): SettingsWithErrors {
  let mergedSettings: SettingsJson = {}
  const allErrors: ValidationError[] = []
  const seenErrors = new Set<string>()
  const seenFiles = new Set<string>()

  // Merge in SETTING_SOURCES order (low → high precedence; later sources
  // override earlier ones), restricted to the sources enabled this session.
  const enabled = new Set(getEnabledSettingSources())
  for (const source of SETTING_SOURCES) {
    if (!enabled.has(source)) continue

    let settings: SettingsJson | null = null
    let errors: ValidationError[] = []

    if (source === 'policySettings') {
      const managed = loadManagedFileSettings()
      settings = managed.settings
      errors = managed.errors
    } else {
      const filePath = getSettingsFilePathForSource(source)
      if (!filePath) continue
      const resolvedPath = resolve(filePath)
      if (seenFiles.has(resolvedPath)) continue
      seenFiles.add(resolvedPath)
      const parsed = parseSettingsFile(filePath)
      settings = parsed.settings
      errors = parsed.errors
    }

    if (settings) {
      mergedSettings = mergeWith(mergedSettings, settings, settingsMergeCustomizer)
    }
    for (const error of errors) {
      const errorKey = `${error.file}:${error.path}:${error.message}`
      if (!seenErrors.has(errorKey)) {
        seenErrors.add(errorKey)
        allErrors.push(error)
      }
    }
  }

  return { settings: mergedSettings, errors: allErrors }
}

/**
 * Merged settings + validation errors from all enabled sources. Cached for the
 * session; resetSettingsCache() invalidates after a write.
 */
export function getSettingsWithErrors(): SettingsWithErrors {
  if (sessionSettingsCache !== null) return sessionSettingsCache
  sessionSettingsCache = loadSettingsFromDisk()
  return sessionSettingsCache
}

/** Merged effective settings from all sources (always at least {}). The loose
 *  `Settings` return type (open index signature) is kept so existing readers
 *  that index arbitrary keys keep compiling. */
export function getInitialSettings(): Settings {
  return (getSettingsWithErrors().settings || {}) as Settings
}

/** @deprecated Use getInitialSettings(). */
export const getSettings_DEPRECATED = getInitialSettings

export type SettingsWithSources = {
  effective: SettingsJson
  /** Ordered low-to-high priority — later entries override earlier ones. */
  sources: Array<{ source: SettingSource; settings: SettingsJson }>
}

/**
 * Effective merged settings alongside the raw per-source settings, in merge
 * priority order. Only includes enabled sources with non-empty content.
 */
export function getSettingsWithSources(): SettingsWithSources {
  resetSettingsCache()
  const sources: SettingsWithSources['sources'] = []
  const enabled = new Set(getEnabledSettingSources())
  for (const source of SETTING_SOURCES) {
    if (!enabled.has(source)) continue
    const settings = getSettingsForSource(source)
    if (settings && Object.keys(settings).length > 0) {
      sources.push({ source, settings })
    }
  }
  return { effective: getInitialSettings(), sources }
}

// Persistent auto-mode opt-in: the opt-in dialog writes skipAutoPermissionPrompt
// to userSettings once accepted, which suppresses the warning dialog on
// subsequent entries into auto mode.
export function hasAutoModeOptIn(): boolean {
  return getInitialSettings().skipAutoPermissionPrompt === true
}

// Settings file path relative to the project root, for display in the rule UI.
export function getRelativeSettingsFilePathForSource(
  source: 'projectSettings' | 'localSettings',
): string {
  return source === 'localSettings'
    ? '.knightcode/settings.local.json'
    : '.knightcode/settings.json'
}

/**
 * Persist a settings patch to a source file. Deep-merges with the existing file
 * (arrays are REPLACED by the provided array — the caller computes the final
 * array; `undefined` values delete the key). Creates parent dirs as needed and
 * invalidates the merged-settings cache. No-op for read-only sources.
 */
export function updateSettingsForSource(
  source: SettingSource,
  settings: Settings,
): { error: Error | null } {
  if (source === 'policySettings' || source === 'flagSettings') {
    return { error: null }
  }

  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) return { error: null }

  try {
    mkdirSync(dirname(filePath), { recursive: true })

    // Read raw existing settings (unvalidated) so a schema-invalid existing file
    // doesn't get clobbered; a JSON syntax error aborts rather than overwrites.
    let existingSettings: SettingsJson = {}
    let raw: string | null = null
    try {
      raw = readFileSync(filePath)
    } catch {
      // File doesn't exist yet — start from empty.
    }
    if (raw !== null && raw.trim() !== '') {
      const parsed = safeParseJSON(raw)
      if (parsed === null) {
        return {
          error: new Error(`Invalid JSON syntax in settings file at ${filePath}`),
        }
      }
      if (parsed && typeof parsed === 'object') {
        existingSettings = parsed as SettingsJson
      }
    }

    const updatedSettings = mergeWith(
      existingSettings,
      settings,
      (
        _objValue: unknown,
        srcValue: unknown,
        key: string | number | symbol,
        object: Record<string | number | symbol, unknown>,
      ) => {
        // undefined means "delete this key"
        if (srcValue === undefined && object && typeof key === 'string') {
          delete object[key]
          return undefined
        }
        // Arrays are replaced wholesale (caller owns the final state)
        if (Array.isArray(srcValue)) return srcValue
        return undefined
      },
    )

    writeFileSync(filePath, JSON.stringify(updatedSettings, null, 2) + '\n')
    resetSettingsCache()
  } catch (e) {
    return {
      error: new Error(`Failed to write settings to ${filePath}: ${e}`),
    }
  }

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
