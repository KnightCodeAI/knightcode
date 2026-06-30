import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  applyExtraBody,
  applyProviderRouting,
  applyReasoning,
  applySampling,
  resolveModelProfile,
} from '../../utils/model/profile/index.js'

export type ReasoningCtx = {
  effort?: string
  hasThinking: boolean
  budgetTokens: number
  maxOutputTokens: number
}

/**
 * Apply per-model sampling, reasoning, extraBody, and provider routing to a
 * request body. Pure; respects the KNIGHTCODE_DISABLE_MODEL_PROFILE escape
 * hatch.
 *
 * The inline thinking block in knightcode.ts remains authoritative for
 * Anthropic `thinking` (it handles every env/override edge case), so we SKIP
 * applyReasoning for Anthropic reasoning kinds here — that prevents this layer
 * from ever overwriting the inline thinking value. applyReasoning therefore
 * only adds reasoning + the answer-token floor for OpenRouter models.
 */
export function applyModelProfileToBody(
  body: Record<string, unknown>,
  modelId: string,
  ctx: ReasoningCtx,
): Record<string, unknown> {
  if (isEnvTruthy(process.env.KNIGHTCODE_DISABLE_MODEL_PROFILE)) return body
  const profile = resolveModelProfile(modelId)
  applySampling(body, profile)
  const kind = profile.reasoning.kind
  if (kind !== 'anthropic-adaptive' && kind !== 'anthropic-budget') {
    applyReasoning(body, profile, ctx)
  }
  applyExtraBody(body, profile)
  applyProviderRouting(body, profile)
  return body
}
