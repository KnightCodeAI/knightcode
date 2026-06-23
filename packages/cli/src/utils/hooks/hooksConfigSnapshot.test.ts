import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { SettingsJson } from '../settings/types.js'
import * as settingsModule from '../settings/settings.js'
import {
  getHooksConfigFromSnapshot,
  resetHooksConfigSnapshot,
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooksConfigSnapshot.js'

const bashHook = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: 'echo hi' }],
}

function settingsBySource(
  map: Partial<Record<string, SettingsJson>>,
): void {
  spyOn(settingsModule, 'getSettingsForSource').mockImplementation(
    (source: string) => map[source] ?? null,
  )
}

// Reset before each test too: the snapshot is module-global and another test
// file may have triggered a lazy capture (caching {}) before our spy is set;
// getHooksConfigFromSnapshot only re-captures when the snapshot is null.
beforeEach(() => {
  resetHooksConfigSnapshot()
})

afterEach(() => {
  resetHooksConfigSnapshot()
  spyOn(settingsModule, 'getSettingsForSource').mockRestore()
})

describe('hooksConfigSnapshot', () => {
  test('surfaces settings.json hooks into the snapshot (the firing linchpin)', () => {
    settingsBySource({
      userSettings: { hooks: { PreToolUse: [bashHook] } } as SettingsJson,
    })
    const snap = getHooksConfigFromSnapshot()
    expect(snap?.PreToolUse).toHaveLength(1)
    expect(snap?.PreToolUse?.[0]?.matcher).toBe('Bash')
  })

  test('merges hooks for the same event across sources', () => {
    settingsBySource({
      userSettings: { hooks: { PreToolUse: [bashHook] } } as SettingsJson,
      projectSettings: {
        hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [] }] },
      } as SettingsJson,
    })
    const snap = getHooksConfigFromSnapshot()
    expect(snap?.PreToolUse).toHaveLength(2)
  })

  test('disableAllHooks in a user source suppresses non-managed hooks', () => {
    settingsBySource({
      userSettings: {
        disableAllHooks: true,
        hooks: { PreToolUse: [bashHook] },
      } as SettingsJson,
    })
    expect(getHooksConfigFromSnapshot()).toEqual({})
    expect(shouldAllowManagedHooksOnly()).toBe(true)
    // Non-managed disable does NOT disable managed hooks.
    expect(shouldDisableAllHooksIncludingManaged()).toBe(false)
  })

  test('empty config when no source defines hooks', () => {
    settingsBySource({})
    expect(getHooksConfigFromSnapshot()).toEqual({})
  })
})
