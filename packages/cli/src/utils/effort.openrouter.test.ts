import { describe, expect, test } from 'bun:test'
import {
  clampEffort,
  getSupportedEffortLevels,
  openRouterEffortLevelsByIdPattern,
  type EffortLevel,
} from './effort.js'

// The OpenRouter effort capability table + the clamp chokepoint together
// guarantee an unsupported effort can never reach the wire. The id-pattern
// resolver is pure (no catalog), so it's tested directly and deterministically.

describe('openRouterEffortLevelsByIdPattern', () => {
  test('gpt-5 base offers none/minimal..high, no max/xhigh', () => {
    expect(openRouterEffortLevelsByIdPattern('openai/gpt-5')).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
    ])
  })

  test('gpt-5.1 swaps minimal for none', () => {
    const levels = openRouterEffortLevelsByIdPattern('openai/gpt-5.1')!
    expect(levels).toContain('none')
    expect(levels).not.toContain('minimal')
    expect(levels).not.toContain('xhigh')
  })

  test('gpt-5.2+ adds xhigh', () => {
    expect(openRouterEffortLevelsByIdPattern('openai/gpt-5.2')).toContain('xhigh')
  })

  test('gpt-5 codex v3+ exposes none..xhigh', () => {
    expect(openRouterEffortLevelsByIdPattern('openai/gpt-5.3-codex')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  test('unversioned gpt-5-chat is a definitive empty match', () => {
    expect(openRouterEffortLevelsByIdPattern('openai/gpt-5-chat')).toEqual([])
  })

  test('versioned gpt-5 chat collapses to a single tier', () => {
    expect(openRouterEffortLevelsByIdPattern('openai/gpt-5.1-chat')).toEqual([
      'medium',
    ])
  })

  test('o-series reasoning models get the base set', () => {
    expect(openRouterEffortLevelsByIdPattern('openai/o3')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ])
  })

  test('grok-3-mini is limited to low/high', () => {
    expect(openRouterEffortLevelsByIdPattern('x-ai/grok-3-mini')).toEqual([
      'low',
      'high',
    ])
  })

  test('anthropic/claude- and google/gemini- families get the base set', () => {
    expect(
      openRouterEffortLevelsByIdPattern('anthropic/claude-3.7-sonnet'),
    ).toEqual(['none', 'low', 'medium', 'high'])
    expect(openRouterEffortLevelsByIdPattern('google/gemini-3-pro')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ])
  })

  test('unrecognized ids return null (caller falls back to the catalog)', () => {
    expect(openRouterEffortLevelsByIdPattern('someorg/mystery-model')).toBeNull()
  })

  test('never emits max for any OpenRouter id pattern', () => {
    for (const id of [
      'openai/gpt-5.4',
      'anthropic/claude-3.7-sonnet',
      'google/gemini-3-pro',
      'x-ai/grok-3-mini',
    ]) {
      expect(openRouterEffortLevelsByIdPattern(id) ?? []).not.toContain('max')
    }
  })
})

describe('getSupportedEffortLevels', () => {
  test('never returns max for a slash-id (OpenRouter) model', () => {
    // Independent of catalog state: max is a first-party-native tier only.
    expect(getSupportedEffortLevels('anthropic/claude-3.7-sonnet')).not.toContain(
      'max',
    )
  })

  test('reasoning-looking unknown ids fall back to the safe base set', () => {
    // Not in any catalog; resolved by the name heuristic.
    expect(getSupportedEffortLevels('mystery/custom-r1-preview')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ])
  })
})

describe('clampEffort', () => {
  const BASE: EffortLevel[] = ['none', 'low', 'medium', 'high']

  test('passes through a supported level unchanged', () => {
    expect(clampEffort('high', BASE)).toBe('high')
  })

  test('clamps an over-range request DOWN to the nearest supported level', () => {
    expect(clampEffort('xhigh', BASE)).toBe('high')
    expect(clampEffort('max', BASE)).toBe('high')
  })

  test('clamps to the lowest supported level when request is below the range', () => {
    expect(clampEffort('none', ['low', 'medium', 'high'])).toBe('low')
    expect(clampEffort('minimal', ['medium', 'high'])).toBe('medium')
  })

  test('returns undefined when the model supports no effort', () => {
    expect(clampEffort('high', [])).toBeUndefined()
  })

  test('honors a model that exposes none (does not bump it up)', () => {
    expect(clampEffort('none', BASE)).toBe('none')
  })
})
