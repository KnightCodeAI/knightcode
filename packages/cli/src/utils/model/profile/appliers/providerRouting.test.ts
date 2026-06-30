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
})
