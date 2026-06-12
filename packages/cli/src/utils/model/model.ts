// TODO: alias resolution, allowlists, and the model picker land with the
// /model phase; the helpers the API layer consumes live here, speaking
// gateway model ids.

import { getModelStrings } from './modelStrings.js'

export type ModelName = string
export type ModelAlias = string
export type ModelShortName = string

export function getDefaultOpusModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  }
  return getModelStrings().opus46
}

export function getDefaultSonnetModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  }
  return getModelStrings().sonnet46
}

export function getDefaultHaikuModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  }
  return getModelStrings().haiku45
}

export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || getDefaultHaikuModel()
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
 * Maps a full model string to a shorter canonical version. Gateway ids
 * carry a vendor prefix ('anthropic/claude-sonnet-4.6'); the canonical
 * form drops the prefix and normalizes dots so capability checks written
 * against upstream names ('claude-sonnet-4-6') keep working.
 */
export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  const base = normalizeModelStringForAPI(fullModelName)
  const withoutVendor = base.includes('/')
    ? base.slice(base.indexOf('/') + 1)
    : base
  // Strip a trailing date stamp (e.g. -20251001) and normalize version dots
  return withoutVendor.replace(/-\d{8}$/, '').replace(/\./g, '-')
}
