import { describe, expect, test } from 'bun:test'
import { resolveModelProfile } from './profile.js'

describe('resolveModelProfile', () => {
  test('folds quirk sampling into the profile', () => {
    expect(resolveModelProfile('qwen/qwen3-coder:free').sampling.temperature).toBe(0.55)
  })
  test('unknown model yields safe defaults (no reasoning, empty sampling)', () => {
    const p = resolveModelProfile('acme/unknown-1')
    expect(p.reasoning.kind).toBe('none')
    expect(p.sampling).toEqual({})
    expect(p.supportsReasoning).toBe(false)
  })
  test('anthropic models resolve to adaptive reasoning', () => {
    expect(resolveModelProfile('anthropic/claude-sonnet-4.6').reasoning.kind).toBe('anthropic-adaptive')
  })
  test('anthropic model without adaptive thinking resolves to budget reasoning', () => {
    // claude-3.5-haiku canonical = 'claude-3-5-haiku' which contains 'haiku'
    // modelSupportsAdaptiveThinking returns false for it → anthropic-budget
    expect(resolveModelProfile('anthropic/claude-3.5-haiku').reasoning.kind).toBe('anthropic-budget')
  })
})
