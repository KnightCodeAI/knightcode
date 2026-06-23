import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getInitialSettings,
  getSettingsForSource,
  resetSettingsCache,
  settingsMergeCustomizer,
  updateSettingsForSource,
} from './settings.js'

const prevConfigDir = process.env.KNIGHTCODE_CONFIG_DIR

function restoreEnv(): void {
  if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
  else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
}

describe('settingsMergeCustomizer', () => {
  test('concatenates + dedups two arrays', () => {
    expect(settingsMergeCustomizer(['a', 'b'], ['b', 'c'])).toEqual([
      'a',
      'b',
      'c',
    ])
  })
  test('returns undefined for non-array values (default lodash merge)', () => {
    expect(settingsMergeCustomizer('x', 'y')).toBeUndefined()
    expect(settingsMergeCustomizer({ a: 1 }, { b: 2 })).toBeUndefined()
  })
})

describe('updateSettingsForSource + getSettingsForSource (userSettings)', () => {
  // Scope to a throwaway config dir so userSettings (which lives under the
  // config home dir) never writes into the real ~/.knightcode or the repo.
  let tmpConfigDir: string

  beforeEach(() => {
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-settings-'))
    process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
    resetSettingsCache()
  })
  afterEach(() => {
    restoreEnv()
    resetSettingsCache()
  })
  afterAll(restoreEnv)

  test('persists a written setting and reads it back', () => {
    expect(getSettingsForSource('userSettings')).toBeNull()
    const { error } = updateSettingsForSource('userSettings', {
      outputStyle: 'concise',
    })
    expect(error).toBeNull()
    expect(getSettingsForSource('userSettings')?.outputStyle).toBe('concise')
    // and it surfaces through the merged effective settings
    expect((getInitialSettings() as { outputStyle?: string }).outputStyle).toBe(
      'concise',
    )
  })

  test('deep-merges across writes; arrays are replaced wholesale', () => {
    updateSettingsForSource('userSettings', {
      availableModels: ['a', 'b'],
      alwaysThinkingEnabled: true,
    })
    updateSettingsForSource('userSettings', { availableModels: ['c'] })
    const s = getSettingsForSource('userSettings')
    expect(s?.availableModels).toEqual(['c'])
    // unrelated key from the first write is preserved by the deep merge
    expect(s?.alwaysThinkingEnabled).toBe(true)
  })

  test('cache invalidation: getInitialSettings reflects a later write', () => {
    expect(
      (getInitialSettings() as { outputStyle?: string }).outputStyle,
    ).toBeUndefined()
    updateSettingsForSource('userSettings', { outputStyle: 'verbose' })
    expect((getInitialSettings() as { outputStyle?: string }).outputStyle).toBe(
      'verbose',
    )
  })

  test('writes are no-ops for read-only sources', () => {
    expect(updateSettingsForSource('policySettings', { outputStyle: 'x' })).toEqual(
      { error: null },
    )
    expect(updateSettingsForSource('flagSettings', { outputStyle: 'x' })).toEqual(
      { error: null },
    )
  })
})
