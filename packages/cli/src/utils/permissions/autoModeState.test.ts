import { afterEach, describe, expect, test } from 'bun:test'
import { isAutoModeActive, setAutoModeActive } from './autoModeState.js'

afterEach(() => setAutoModeActive(false))

describe('autoModeState', () => {
  test('defaults to inactive', () => {
    expect(isAutoModeActive()).toBe(false)
  })

  test('set/get round-trips', () => {
    setAutoModeActive(true)
    expect(isAutoModeActive()).toBe(true)
    setAutoModeActive(false)
    expect(isAutoModeActive()).toBe(false)
  })
})
