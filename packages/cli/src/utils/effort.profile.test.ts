import { describe, expect, test } from 'bun:test'
import { getDefaultEffortForModel } from './effort.js'

describe('getDefaultEffortForModel for OpenRouter reasoning models', () => {
  test('returns undefined for a plain non-reasoning slug (unchanged behavior)', () => {
    // qwen3-coder is not reasoning-capable; with a cold catalog it stays undefined.
    expect(getDefaultEffortForModel('qwen/qwen3-coder:free')).toBeUndefined()
  })
})
