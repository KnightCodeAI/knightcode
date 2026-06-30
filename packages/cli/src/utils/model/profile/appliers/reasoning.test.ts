import { describe, expect, test } from 'bun:test'
import { applyReasoning } from './reasoning.js'
import { MIN_COMPLETION_FLOOR } from '../types.js'
import type { ModelProfile } from '../types.js'

const base = (over: Partial<ModelProfile>): ModelProfile => ({
  id: 'x', supportsReasoning: true, supportsTools: true,
  supportedParameters: new Set(['reasoning']),
  sampling: {}, reasoning: { kind: 'none' }, extraBody: {},
  schemaTransforms: [], messageTransforms: [], ...over,
})
const ctx = (over: Partial<{ effort: string; hasThinking: boolean; budgetTokens: number; maxOutputTokens: number }> = {}) =>
  ({ hasThinking: true, budgetTokens: 8000, maxOutputTokens: 32000, ...over })

describe('applyReasoning', () => {
  test('anthropic-adaptive sets thinking adaptive, no reasoning field', () => {
    const out = applyReasoning({}, base({ reasoning: { kind: 'anthropic-adaptive' } }), ctx())
    expect(out.thinking).toEqual({ type: 'adaptive' })
    expect('reasoning' in out).toBe(false)
  })
  test('openrouter-effort sets reasoning.effort and raises max_tokens to the floor', () => {
    const out = applyReasoning({ max_tokens: 1000 }, base({ reasoning: { kind: 'openrouter-effort' } }), ctx({ effort: 'high', maxOutputTokens: 32000 }))
    expect(out.reasoning).toEqual({ effort: 'high' })
    expect(out.max_tokens).toBe(MIN_COMPLETION_FLOOR)
  })
  test('none leaves the body untouched', () => {
    const out = applyReasoning({ max_tokens: 500 }, base({ reasoning: { kind: 'none' } }), ctx())
    expect('thinking' in out).toBe(false)
    expect('reasoning' in out).toBe(false)
    expect(out.max_tokens).toBe(500)
  })

  test('anthropic-budget — formula clamps to maxOutputTokens-1', () => {
    const out = applyReasoning({}, base({ reasoning: { kind: 'anthropic-budget', budgetTokens: 8000 } }), ctx({ hasThinking: true, maxOutputTokens: 5000 }))
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 4999 })
    expect('reasoning' in out).toBe(false)
  })

  test('anthropic-budget — formula uses budgetTokens when smaller', () => {
    const out = applyReasoning({}, base({ reasoning: { kind: 'anthropic-budget', budgetTokens: 2000 } }), ctx({ maxOutputTokens: 32000 }))
    expect(out.thinking.budget_tokens).toBe(2000)
  })

  test('enable-flag merges body + applies answer floor', () => {
    const out = applyReasoning(
      { max_tokens: 1000 },
      base({ reasoning: { kind: 'enable-flag', body: { chat_template_args: { enable_thinking: true } } } }),
      ctx({ maxOutputTokens: 32000 }),
    )
    expect(out.chat_template_args).toEqual({ enable_thinking: true })
    expect(out.max_tokens).toBe(MIN_COMPLETION_FLOOR)
  })

  test('hasThinking false leaves body untouched', () => {
    const out = applyReasoning({ max_tokens: 500, foo: 'bar' }, base({ reasoning: { kind: 'anthropic-adaptive' } }), ctx({ hasThinking: false }))
    expect('thinking' in out).toBe(false)
    expect('reasoning' in out).toBe(false)
    expect(out.max_tokens).toBe(500)
    expect(out.foo).toBe('bar')
  })

  test('ensureAnswerFloor does not lower an already-large max_tokens', () => {
    const out = applyReasoning({ max_tokens: 30000 }, base({ reasoning: { kind: 'openrouter-effort' } }), ctx({ maxOutputTokens: 32000 }))
    expect(out.max_tokens).toBe(30000)
  })
})
