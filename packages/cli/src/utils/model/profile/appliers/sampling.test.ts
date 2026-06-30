import { describe, expect, test } from 'bun:test'
import { applySampling } from './sampling.js'
import type { ModelProfile } from '../types.js'

const base = (over: Partial<ModelProfile>): ModelProfile => ({
  id: 'x', supportsReasoning: false, supportsTools: true,
  supportedParameters: new Set(['temperature', 'top_p', 'top_k']),
  sampling: {}, reasoning: { kind: 'none' }, extraBody: {},
  schemaTransforms: [], messageTransforms: [], ...over,
})

describe('applySampling', () => {
  test('sets supported sampling params', () => {
    const out = applySampling({}, base({ sampling: { temperature: 0.55, topP: 1, topK: 40 } }))
    expect(out.temperature).toBe(0.55)
    expect(out.top_p).toBe(1)
    expect(out.top_k).toBe(40)
  })
  test('omits a param the catalog does not support', () => {
    const out = applySampling({}, base({
      sampling: { temperature: 0.5, topK: 40 },
      supportedParameters: new Set(['temperature']),
    }))
    expect(out.temperature).toBe(0.5)
    expect('top_k' in out).toBe(false)
  })
})
