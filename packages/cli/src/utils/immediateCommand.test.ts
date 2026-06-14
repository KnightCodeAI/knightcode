import { afterEach, describe, expect, test } from 'bun:test'
import { shouldInferenceConfigCommandBeImmediate } from './immediateCommand.js'

const originalUserType = process.env.USER_TYPE

afterEach(() => {
  if (originalUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalUserType
  }
})

describe('shouldInferenceConfigCommandBeImmediate', () => {
  test('is immediate for ant users', () => {
    process.env.USER_TYPE = 'ant'
    expect(shouldInferenceConfigCommandBeImmediate()).toBe(true)
  })

  test('falls back to the experiment default (off) for external users', () => {
    delete process.env.USER_TYPE
    expect(shouldInferenceConfigCommandBeImmediate()).toBe(false)
  })
})
