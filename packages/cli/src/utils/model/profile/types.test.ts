import { describe, expect, test } from 'bun:test'
import { MIN_COMPLETION_FLOOR } from './types.js'

describe('profile types', () => {
  test('MIN_COMPLETION_FLOOR is a positive integer', () => {
    expect(Number.isInteger(MIN_COMPLETION_FLOOR)).toBe(true)
    expect(MIN_COMPLETION_FLOOR).toBeGreaterThan(0)
  })
})
