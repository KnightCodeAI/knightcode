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
  test('Anthropic id is cached: two calls return the same object reference', () => {
    const a = resolveModelProfile('anthropic/claude-sonnet-4.6')
    const b = resolveModelProfile('anthropic/claude-sonnet-4.6')
    expect(a).toBe(b)
  })
  test('unknown non-Anthropic id (cold catalog) returns safe-default profile and is stable across calls', () => {
    const p1 = resolveModelProfile('acme/unknown-cold-1')
    expect(p1.reasoning.kind).toBe('none')
    expect(p1.sampling).toEqual({})
    expect(p1.supportsReasoning).toBe(false)
    const p2 = resolveModelProfile('acme/unknown-cold-1')
    expect(p2).toEqual(p1)
  })
})
