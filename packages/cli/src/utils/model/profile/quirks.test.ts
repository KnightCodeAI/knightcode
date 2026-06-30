import { describe, expect, test } from 'bun:test'
import { matchQuirks } from './quirks.js'

describe('matchQuirks', () => {
  test('qwen gets temperature 0.55', () => {
    expect(matchQuirks('qwen/qwen3-coder:free').sampling?.temperature).toBe(0.55)
  })
  test('gemini gets a schema transform', () => {
    expect((matchQuirks('google/gemini-2.5-flash').schemaTransforms ?? []).length).toBeGreaterThan(0)
  })
  test('an unmatched model yields an empty override', () => {
    const q = matchQuirks('acme/unknown-1')
    expect(q.sampling).toBeUndefined()
    expect(q.reasoning).toBeUndefined()
    expect(q.schemaTransforms ?? []).toEqual([])
  })
})
