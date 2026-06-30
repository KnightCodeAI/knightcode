import { getModelSupportedParameters, getOpenRouterModel } from '../openRouterModels.js'
import { getMaxThinkingTokensForModel } from '../../context.js'
import { modelSupportsAdaptiveThinking } from '../../thinking.js'
import { matchQuirks } from './quirks.js'
import type { ModelProfile, ReasoningStrategy } from './types.js'

const cache = new Map<string, ModelProfile>()

/** Default reasoning strategy from catalog capability when no quirk overrides it. */
function defaultReasoning(id: string, supportsReasoning: boolean): ReasoningStrategy {
  const lower = id.toLowerCase()
  if (lower.startsWith('anthropic/') || lower.includes('claude')) {
    if (modelSupportsAdaptiveThinking(id)) {
      return { kind: 'anthropic-adaptive' }
    }
    return { kind: 'anthropic-budget', budgetTokens: getMaxThinkingTokensForModel(id) }
  }
  if (supportsReasoning) return { kind: 'openrouter-effort' }
  return { kind: 'none' }
}

export function resolveModelProfile(id: string): ModelProfile {
  const cached = cache.get(id)
  if (cached) return cached

  const entry = getOpenRouterModel(id)
  const supportedParameters = getModelSupportedParameters(id)
  const supportsReasoning = entry?.supportsReasoning ?? false
  const quirks = matchQuirks(id)

  const profile: ModelProfile = {
    id,
    contextLength: entry?.contextLength || undefined,
    maxOutputTokens: entry?.maxCompletionTokens,
    supportsReasoning,
    supportsTools: entry?.supportsTools ?? true,
    supportedParameters,
    sampling: quirks.sampling ?? {},
    reasoning: quirks.reasoning ?? defaultReasoning(id, supportsReasoning),
    extraBody: quirks.extraBody ?? {},
    schemaTransforms: quirks.schemaTransforms ?? [],
    messageTransforms: quirks.messageTransforms ?? [],
  }
  cache.set(id, profile)
  return profile
}
