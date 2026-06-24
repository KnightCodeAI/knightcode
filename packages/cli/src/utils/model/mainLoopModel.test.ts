import { afterEach, describe, expect, test } from 'bun:test'
import {
  getMainLoopModelOverride,
  setMainLoopModelOverride,
} from '../../bootstrap/state.js'
import { getDefaultMainLoopModelSetting, getMainLoopModel } from './model.js'

// getMainLoopModel() resolves: in-session override → persisted userSettings.model
// → default. These tests cover the override and default ends; the persisted-setting
// middle is exercised by the boot-seed in AppStateStore + the runtime.
describe('getMainLoopModel resolution', () => {
  const original = getMainLoopModelOverride()
  afterEach(() => setMainLoopModelOverride(original))

  test('returns the in-session override when set', () => {
    setMainLoopModelOverride('anthropic/claude-3.5-haiku')
    expect(getMainLoopModel()).toBe('anthropic/claude-3.5-haiku')
  })

  test('always resolves to a concrete model id (never null/undefined)', () => {
    // With no override, resolution falls through to the persisted setting then
    // the default. Either way it must be a concrete, non-empty model id — this
    // is the contract callers (queryWithModel, spinner, FileReadTool) rely on.
    // (Not asserting the exact value: the ambient dev config may legitimately
    // carry a persisted userSettings.model.)
    setMainLoopModelOverride(undefined)
    const resolved = getMainLoopModel()
    expect(typeof resolved).toBe('string')
    expect(resolved.length).toBeGreaterThan(0)
  })

  test('the default setting is itself a concrete model id', () => {
    expect(typeof getDefaultMainLoopModelSetting()).toBe('string')
    expect(getDefaultMainLoopModelSetting().length).toBeGreaterThan(0)
  })
})
