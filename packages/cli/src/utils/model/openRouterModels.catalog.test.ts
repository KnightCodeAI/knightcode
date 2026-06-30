import { describe, expect, test } from 'bun:test'
import { getModelSupportedParameters } from './openRouterModels.js'

describe('catalog supported-parameters accessor', () => {
  test('returns an empty set for an unknown model (no crash)', () => {
    const params = getModelSupportedParameters('does/not-exist-xyz')
    expect(params instanceof Set).toBe(true)
    expect(params.size).toBe(0)
  })
})
