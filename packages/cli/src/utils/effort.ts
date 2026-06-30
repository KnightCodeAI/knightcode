// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { isUltrathinkEnabled } from './thinking.js'
import { getInitialSettings } from './settings/settings.js'
import { isProSubscriber, isMaxSubscriber, isTeamSubscriber } from './auth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAPIProvider } from './model/providers.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { isEnvTruthy } from './envUtils.js'
import type { EffortLevel } from 'src/entrypoints/sdk/runtimeTypes.js'
import { getOpenRouterModel } from './model/openRouterModels.js'

export type { EffortLevel }

export const EFFORT_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly EffortLevel[]

export type EffortValue = EffortLevel | number

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports the effort parameter.
export function modelSupportsEffort(model: string): boolean {
  if (model.includes('/')) {
    return getSupportedEffortLevels(model).length > 0
  }
  const m = model.toLowerCase()
  if (isEnvTruthy(process.env.KNIGHTCODE_CODE_ALWAYS_ENABLE_EFFORT)) {
    return true
  }
  const supported3P = get3PModelCapabilityOverride(model, 'effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  // Supported by a subset of KnightCode 4 models
  if (m.includes('opus-4-6') || m.includes('sonnet-4-6')) {
    return true
  }
  // Exclude any other known legacy models (haiku, older opus/sonnet variants)
  if (m.includes('haiku') || m.includes('sonnet') || m.includes('opus')) {
    return false
  }

  // IMPORTANT: Do not change the default effort support without notifying
  // the model launch DRI and research. This is a sensitive setting that can
  // greatly affect model quality and bashing.

  // Default to true for unknown model strings on 1P.
  // Do not default to true for 3P as they have different formats for their
  // model strings
  return getAPIProvider() === 'firstParty'
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports 'max' effort.
// Per API docs, 'max' is Opus 4.6 only for public models — other models return an error.
export function modelSupportsMaxEffort(model: string): boolean {
  if (model.includes('/')) {
    return false
  }
  const supported3P = get3PModelCapabilityOverride(model, 'max_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (model.toLowerCase().includes('opus-4-6')) {
    return true
  }
  return false
}

// Levels every OpenRouter reasoning model accepts. `none` is always safe — it
// is mapped to `reasoning: { enabled: false }` on the wire (see
// configureEffortParams), not sent as an effort string.
const OPENROUTER_BASE_EFFORTS: EffortLevel[] = ['none', 'low', 'medium', 'high']

/**
 * Effort tiers a GPT-5-family model exposes over OpenRouter. Ported (trimmed)
 * from OpenCode's transform.ts version table. `minimal`/`xhigh` are
 * OpenAI-specific tiers; everything else is gated to OPENROUTER_BASE_EFFORTS.
 * Returns null when `id` is not a gpt-5 model.
 */
function gpt5EffortLevels(id: string): EffortLevel[] | null {
  if (!/(?:^|\/)gpt-5(?:[.-]|$)/.test(id)) return null
  // Version number, e.g. "gpt-5.2" -> 2. Undefined for the base "gpt-5".
  const version = Number(/(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/.exec(id)?.[1]) || undefined
  if (id.includes('-chat')) {
    // Unversioned chat models don't expose a reasoning-effort control.
    return version === undefined ? [] : ['medium']
  }
  if (id.includes('-pro')) return ['high']
  if (id.includes('codex')) {
    // codex-max and codex v2+ add xhigh; v3+ adds none.
    if (version !== undefined && version >= 3) {
      return ['none', 'low', 'medium', 'high', 'xhigh']
    }
    if (id.includes('codex-max') || (version !== undefined && version >= 2)) {
      return ['low', 'medium', 'high', 'xhigh']
    }
    return ['low', 'medium', 'high']
  }
  if (version !== undefined && version >= 2) {
    return ['none', 'low', 'medium', 'high', 'xhigh']
  }
  if (version === 1) {
    // gpt-5.1 replaced gpt-5's `minimal` tier with `none`.
    return ['none', 'low', 'medium', 'high']
  }
  // Base gpt-5.
  return ['none', 'minimal', 'low', 'medium', 'high']
}

/**
 * Resolve effort tiers for an OpenRouter model id from id/family patterns
 * alone, independent of the live catalog. Returns null when no pattern matches
 * (the caller then falls back to the catalog's reasoning flag). Pure and
 * deterministic — the unit-testable core of the capability table.
 */
export function openRouterEffortLevelsByIdPattern(
  modelId: string,
): EffortLevel[] | null {
  const m = modelId.toLowerCase()

  // GPT-5 family (version-aware). Returns [] for tiers with no effort control
  // (e.g. unversioned chat), which is a definitive match, not "no match".
  const gpt5 = gpt5EffortLevels(m)
  if (gpt5 !== null) return gpt5

  // OpenAI o-series reasoning models.
  if (/(?:^|\/)o[134](?:-|$)/.test(m)) return OPENROUTER_BASE_EFFORTS

  // xAI grok-3-mini exposes only low/high (per xAI reasoning docs).
  if (m.includes('grok-3-mini')) return ['low', 'high']

  // anthropic/claude- and google/gemini- reasoning families.
  if (m.includes('anthropic/claude-') || m.includes('google/gemini')) {
    return OPENROUTER_BASE_EFFORTS
  }

  return null
}

export function getSupportedEffortLevels(model: string): EffortLevel[] {
  const m = model.toLowerCase()

  if (model.includes('/')) {
    const orModel = getOpenRouterModel(model)
    // The live catalog is authoritative: a model it marks non-reasoning gets
    // no effort control, even if its id looks like a reasoning model.
    if (orModel && !orModel.supportsReasoning) {
      return []
    }

    // Family/version-specific tiers from id patterns.
    const byPattern = openRouterEffortLevelsByIdPattern(m)
    if (byPattern !== null) return byPattern

    // Catalog says it reasons but we have no specific table → safe base set.
    if (orModel?.supportsReasoning) {
      return OPENROUTER_BASE_EFFORTS
    }

    // Not in the catalog yet, but the id looks like a reasoning model. Offer
    // the safe base set rather than hiding the control.
    if (
      m.includes('deepseek') ||
      m.includes('-r1') ||
      m.includes('reasoning') ||
      m.includes('thinking')
    ) {
      return OPENROUTER_BASE_EFFORTS
    }

    return []
  }

  // Legacy / 1P (alias) models — preserve existing first-party behavior.
  if (!modelSupportsEffort(model)) {
    return []
  }
  if (modelSupportsMaxEffort(model)) {
    return ['low', 'medium', 'high', 'max']
  }
  return ['low', 'medium', 'high']
}

const ORDERED_EFFORT_LEVELS: EffortLevel[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

export function clampEffort(
  requested: EffortLevel,
  supported: EffortLevel[],
): EffortLevel | undefined {
  if (supported.length === 0) {
    return undefined
  }
  if (supported.includes(requested)) {
    return requested
  }
  const requestedIdx = ORDERED_EFFORT_LEVELS.indexOf(requested)
  // Find the highest supported level whose index <= requestedIdx
  let best: EffortLevel | undefined = undefined
  let bestIdx = -1
  for (const s of supported) {
    const sIdx = ORDERED_EFFORT_LEVELS.indexOf(s)
    if (sIdx <= requestedIdx && sIdx > bestIdx) {
      best = s
      bestIdx = sIdx
    }
  }
  // If no supported level is <= requested, clamp to the lowest supported level
  if (best === undefined) {
    let minIdx = Number.MAX_SAFE_INTEGER
    for (const s of supported) {
      const sIdx = ORDERED_EFFORT_LEVELS.indexOf(s)
      if (sIdx < minIdx) {
        best = s
        minIdx = sIdx
      }
    }
  }
  return best
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  const str = String(value).toLowerCase()
  if (isEffortLevel(str)) {
    return str
  }
  const numericValue = parseInt(str, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

/**
 * Numeric values are model-default only and not persisted.
 * 'max' is session-scoped for external users (ants can persist it) — it is a
 * first-party-native tier and is never produced for OpenRouter models. All other
 * string levels (none/minimal/low/medium/high/xhigh) persist as-is.
 * Write sites call this before saving to settings so the Zod schema never
 * rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'none' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }
  if (value === 'max' && process.env.USER_TYPE === 'ant') {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel | undefined {
  // toPersistableEffort filters 'max' for non-ants on read, so a manually
  // edited settings.json doesn't leak session-scoped max into a fresh session.
  return toPersistableEffort(getInitialSettings().effortLevel)
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in ModelPicker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortValue | null | undefined {
  const envOverride = process.env.KNIGHTCODE_CODE_EFFORT_LEVEL
  return envOverride?.toLowerCase() === 'unset' ||
    envOverride?.toLowerCase() === 'auto'
    ? null
    : parseEffortValue(envOverride)
}

/**
 * Resolve the effort value that will actually be sent to the API for a given
 * model, following the full precedence chain:
 *   env KNIGHTCODE_CODE_EFFORT_LEVEL → appState.effortValue → model default
 *
 * Returns undefined when no effort parameter should be sent (env set to
 * 'unset', or no default exists for the model).
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
): EffortValue | undefined {
  const envOverride = getEffortEnvOverride()
  if (envOverride === null) {
    return undefined
  }
  const resolved =
    envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model)
  if (resolved === undefined) {
    return undefined
  }
  if (typeof resolved === 'number') {
    return resolved
  }
  const supported = getSupportedEffortLevels(model)
  return clampEffort(resolved, supported)
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort
 * with the 'high' fallback (what the API uses when no effort param is sent).
 * Single source of truth for the status bar and /effort output.
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 * Returns empty string if the user hasn't explicitly set an effort value.
 * Delegates to resolveAppliedEffort() so the displayed level matches what
 * the API actually receives (including max→high clamp for non-Opus models).
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
): string {
  if (effortValue === undefined) return ''
  const resolved = resolveAppliedEffort(model, effortValue)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'max'
  }
  return 'high'
}

/**
 * Get user-facing description for effort levels
 *
 * @param level The effort level to describe
 * @returns Human-readable description
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  switch (level) {
    case 'none':
      return 'No reasoning effort (thinking disabled)'
    case 'minimal':
      return 'Minimal reasoning effort for quick answers'
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      return 'Extremely high capability with deep thinking'
    case 'max':
      return 'Maximum capability with deepest reasoning (Opus 4.6 only)'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 *
 * @param value The effort value to describe
 * @returns Human-readable description
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export type OpusDefaultEffortConfig = {
  enabled: boolean
  dialogTitle: string
  dialogDescription: string
}

const OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT: OpusDefaultEffortConfig = {
  enabled: true,
  dialogTitle: 'We recommend medium effort for Opus',
  dialogDescription:
    'Effort determines how long KnightCode thinks for when completing your task. We recommend medium effort for most tasks to balance speed and intelligence and maximize rate limits. Use ultrathink to trigger high effort when needed.',
}

export function getOpusDefaultEffortConfig(): OpusDefaultEffortConfig {
  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'knightcode_grey_step2',
    OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
  )
  return {
    ...OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
    ...config,
  }
}

// @[MODEL LAUNCH]: Update the default effort levels for new models
export function getDefaultEffortForModel(
  model: string,
): EffortValue | undefined {
  // IMPORTANT: Do not change the default effort level without notifying
  // the model launch DRI and research. Default effort is a sensitive setting
  // that can greatly affect model quality and bashing.

  // Default effort on Opus 4.6 to medium for Pro.
  // Max/Team also get medium when the knightcode_grey_step2 config is enabled.
  if (model.toLowerCase().includes('opus-4-6')) {
    if (isProSubscriber()) {
      return 'medium'
    }
    if (
      getOpusDefaultEffortConfig().enabled &&
      (isMaxSubscriber() || isTeamSubscriber())
    ) {
      return 'medium'
    }
  }

  // When ultrathink feature is on, default effort to medium (ultrathink bumps to high)
  if (isUltrathinkEnabled() && modelSupportsEffort(model)) {
    return 'medium'
  }

  // OpenRouter reasoning-capable models default to 'medium' so the reasoning
  // applier sends a concrete effort instead of nothing (BYOK has no 1P default
  // resolution). Slug contains a vendor prefix; catalog says if it reasons.
  // Anthropic/Claude ids are excluded: they go through the 1P thinking path and
  // must not receive a redundant `reasoning` param alongside `thinking`.
  const lower = model.toLowerCase()
  const isAnthropic = lower.startsWith('anthropic/') || lower.includes('claude')
  if (model.includes('/') && !isAnthropic && getOpenRouterModel(model)?.supportsReasoning) {
    return 'medium'
  }

  // Fallback to undefined, which means we don't set an effort level. This
  // should resolve to high effort level in the API.
  return undefined
}
