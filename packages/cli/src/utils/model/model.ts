// TODO: alias resolution, allowlists, and the model picker land with the
// /model phase; the helpers the API layer consumes live here, speaking
// gateway model ids.

import { getModelStrings } from './modelStrings.js'
import type { PermissionMode } from '../../types/permissions.js'

export type ModelName = string
export type ModelAlias = string
export type ModelShortName = string
// alias / full model name / null (use the default)
export type ModelSetting = ModelName | ModelAlias | null

export function getDefaultOpusModel(): ModelName {
  if (process.env.KNIGHTCODE_DEFAULT_OPUS_MODEL) {
    return process.env.KNIGHTCODE_DEFAULT_OPUS_MODEL
  }
  return getModelStrings().opus46
}

export function getDefaultSonnetModel(): ModelName {
  if (process.env.KNIGHTCODE_DEFAULT_SONNET_MODEL) {
    return process.env.KNIGHTCODE_DEFAULT_SONNET_MODEL
  }
  return getModelStrings().sonnet46
}

export function getDefaultHaikuModel(): ModelName {
  if (process.env.KNIGHTCODE_DEFAULT_HAIKU_MODEL) {
    return process.env.KNIGHTCODE_DEFAULT_HAIKU_MODEL
  }
  return getModelStrings().haiku45
}

export function getSmallFastModel(): ModelName {
  return process.env.KNIGHTCODE_SMALL_FAST_MODEL || getDefaultHaikuModel()
}

export function isNonCustomOpusModel(model: ModelName): boolean {
  return (
    model === getModelStrings().opus40 ||
    model === getModelStrings().opus41 ||
    model === getModelStrings().opus45 ||
    model === getModelStrings().opus46
  )
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}

/**
 * Returns a full model name for use in this session, possibly after
 * resolving a model alias. Supports the [1m] suffix on aliases to request
 * the 1M context window without each variant needing its own alias.
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  const modelInputTrimmed = modelInput.trim()
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = /\[1m]$/i.test(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  switch (modelString) {
    case 'opusplan': // Sonnet is default, Opus in plan mode
    case 'sonnet':
      return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
    case 'haiku':
      return getDefaultHaikuModel() + (has1mTag ? '[1m]' : '')
    case 'opus':
    case 'best':
      return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
    default:
  }

  // Preserve original case for custom model names; only strip a [1m]
  // suffix if present, maintaining the case of the base model.
  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  return getDefaultSonnetModel()
}

/**
 * Non-React resolver for the active main-loop model. Mirrors the
 * {@link useMainLoopModel} hook's resolution for code outside React (spinner,
 * FileReadTool, micro-compaction, …): the in-session override (set by
 * onChangeAppState when the user runs /model) → the persisted setting
 * (userSettings.model, for a fresh session before any change) → the default.
 *
 * Imports are called lazily inside the body to avoid an import-cycle TDZ with
 * bootstrap/state (which type-imports ModelSetting from here).
 */
export function getMainLoopModel(): ModelName {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getMainLoopModelOverride } =
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  const { getInitialSettings } =
    require('../settings/settings.js') as typeof import('../settings/settings.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return parseUserSpecifiedModel(
    getMainLoopModelOverride() ??
      getInitialSettings().model ??
      getDefaultMainLoopModelSetting(),
  )
}

/**
 * Maps a full model string to a shorter canonical version. Gateway ids
 * carry a vendor prefix ('anthropic/claude-sonnet-4.6'); the canonical
 * form drops the prefix and normalizes dots so capability checks written
 * against upstream names ('claude-sonnet-4-6') keep working.
 */
/** Map a first-party-format model id to its canonical short name. */
export function firstPartyNameToCanonical(name: string): ModelShortName {
  return name.replace(/-\d{8}$/, '')
}

export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  const base = normalizeModelStringForAPI(fullModelName)
  const withoutVendor = base.includes('/')
    ? base.slice(base.indexOf('/') + 1)
    : base
  // Strip a trailing date stamp (e.g. -20251001) and normalize version dots
  return withoutVendor.replace(/-\d{8}$/, '').replace(/\./g, '-')
}

// TODO: alias-based plan-mode model switching (opusplan/sonnetplan) is a hosted
// concept that doesn't apply to a BYOK build — the configured model is used as
// is. Kept with the upstream signature so the query loop ports unchanged.
export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  return params.mainLoopModel
}

// In a BYOK build the model id is the display name; the hosted public-name and
// codename-masking table isn't ported.
export function renderModelName(model: ModelName): string {
  return model
}

// TODO: alias capitalization (e.g. "sonnet" → "Sonnet") lands with the /model
// phase's alias registry; until then only the opusplan label is special-cased
// and everything else renders as its raw model name.
export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Opus Plan'
  }
  return renderModelName(setting)
}

// Human-readable model label for the footer/status. null means "use the
// default"; otherwise show the input and, if it resolves to a different id,
// the resolved id in parentheses.
export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

export function getDefaultMainLoopModel(): ModelName {
  return getDefaultMainLoopModelSetting()
}

// TODO: the Opus 1M-context merge is a hosted serving concept; a BYOK build has
// no such gating, so the merged 1M variant is never offered.
export function isOpus1mMergeEnabled(): boolean {
  return false
}

// TODO: per-skill model overrides honor a 1M-context guard in the hosted build.
// With 1M gating off, a skill's requested model is used as-is.
export function resolveSkillModelOverride(
  skillModel: string,
  _currentModel: string,
): string {
  return skillModel
}

// TODO: the user-specified model override (from /model and --model) is read by
// the harness; until then there is no explicit override and the default is used.
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  return undefined
}

// In a BYOK build there is no hosted-account default; the configured default
// model is shown directly.
export function getKnightcodeAiUserDefaultModelDescription(_fastMode = false): string {
  return `Default (${getDefaultMainLoopModelSetting()})`
}

// Render a default-model setting label. The BYOK build has no plan-mode alias
// switching, so the resolved model id is shown as-is.
export function renderDefaultModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Opus in plan mode, else Sonnet'
  }
  return renderModelName(parseUserSpecifiedModel(setting))
}

// TODO: hosted per-tier pricing suffixes don't apply to a BYOK build.
export function getOpus46PricingSuffix(_fastMode: boolean): string {
  return ''
}

// In a BYOK build the model id is its own marketing name.
export function getMarketingNameForModel(modelId: string): string | undefined {
  return renderModelName(modelId)
}
