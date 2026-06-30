import { describe, expect, test } from 'bun:test'
import { applyModelProfileToBody } from './modelProfile.js'

const ctx = {
  effort: undefined,
  hasThinking: true,
  budgetTokens: 8000,
  maxOutputTokens: 32000,
}

describe('applyModelProfileToBody', () => {
  test('qwen body gets temperature 0.55 and provider routing', () => {
    const out = applyModelProfileToBody(
      { max_tokens: 8000 },
      'qwen/qwen3-coder:free',
      ctx,
    )
    expect(out.temperature).toBe(0.55)
    expect(out.provider).toEqual({ require_parameters: true })
  })

  test('disabled via env is a no-op', () => {
    process.env.KNIGHTCODE_DISABLE_MODEL_PROFILE = '1'
    const out = applyModelProfileToBody(
      { max_tokens: 8000 },
      'qwen/qwen3-coder:free',
      ctx,
    )
    delete process.env.KNIGHTCODE_DISABLE_MODEL_PROFILE
    expect('temperature' in out).toBe(false)
    expect('provider' in out).toBe(false)
  })

  test('Anthropic id: applier never sets thinking or reasoning (inline block owns thinking)', () => {
    const out = applyModelProfileToBody(
      { max_tokens: 8000 },
      'anthropic/claude-sonnet-4.6',
      ctx,
    )
    expect('thinking' in out).toBe(false)
    expect('reasoning' in out).toBe(false)
    // provider routing still applies to Anthropic (intentional, beneficial)
    expect(out.provider).toEqual({ require_parameters: true })
  })
})
