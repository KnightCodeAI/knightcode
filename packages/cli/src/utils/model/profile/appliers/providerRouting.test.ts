import { describe, expect, test } from 'bun:test'
import { applyProviderRouting } from './providerRouting.js'
import type { ModelProfile } from '../types.js'

const base = (over: Partial<ModelProfile> = {}): ModelProfile => ({
  id: 'x', supportsReasoning: false, supportsTools: true,
  supportedParameters: new Set(), sampling: {}, reasoning: { kind: 'none' },
  extraBody: {}, schemaTransforms: [], messageTransforms: [], ...over,
})

describe('applyProviderRouting', () => {
  test('sets require_parameters so backends must honor sent params', () => {
    const out = applyProviderRouting({}, base())
    expect(out.provider).toEqual({ require_parameters: true })
  })
  test('a profile-supplied provider override wins', () => {
    const out = applyProviderRouting({}, base({ extraBody: { provider: { order: ['Anthropic'], require_parameters: true } } }))
    expect(out.provider).toEqual({ order: ['Anthropic'], require_parameters: true })
  })
  test('a user-supplied existing body.provider is preserved and gains require_parameters', () => {
    const out = applyProviderRouting({ provider: { order: ['DeepInfra'] } }, base())
    expect(out.provider).toEqual({ order: ['DeepInfra'], require_parameters: true })
  })
  test('an array body.provider is ignored (treated as no existing)', () => {
    const out = applyProviderRouting({ provider: [1, 2] }, base())
    expect(out.provider).toEqual({ require_parameters: true })
  })
})
