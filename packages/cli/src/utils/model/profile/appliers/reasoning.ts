import { MIN_COMPLETION_FLOOR, type ModelProfile } from '../types.js'

type Ctx = {
  effort?: string
  hasThinking: boolean
  budgetTokens: number
  maxOutputTokens: number
}

/** Ensure max_tokens leaves room for a real answer when reasoning is on. */
function ensureAnswerFloor(body: Record<string, any>, maxOutputTokens: number) {
  const floor = Math.min(MIN_COMPLETION_FLOOR, maxOutputTokens)
  const current = typeof body.max_tokens === 'number' ? body.max_tokens : 0
  if (current < floor) body.max_tokens = floor
}

/**
 * Set the reasoning signal appropriate to the model. Sets exactly one of
 * `thinking` (Anthropic) / `reasoning` (OpenRouter) / an enable-flag merge.
 * No-op when reasoning is disabled for this turn or unsupported.
 */
export function applyReasoning(
  body: Record<string, any>,
  profile: ModelProfile,
  ctx: Ctx,
): Record<string, any> {
  if (!ctx.hasThinking) return body
  const r = profile.reasoning
  switch (r.kind) {
    case 'anthropic-adaptive':
      body.thinking = { type: 'adaptive' }
      return body
    case 'anthropic-budget':
      body.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(ctx.maxOutputTokens - 1, r.budgetTokens),
      }
      return body
    case 'openrouter-effort':
      if (ctx.effort === 'none') {
        body.reasoning = { enabled: false }
      } else {
        body.reasoning = { effort: ctx.effort ?? 'medium' }
        ensureAnswerFloor(body, ctx.maxOutputTokens)
      }
      return body
    case 'enable-flag':
      Object.assign(body, r.body)
      ensureAnswerFloor(body, ctx.maxOutputTokens)
      return body
    case 'none':
    default:
      return body
  }
}
