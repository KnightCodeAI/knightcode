import { describe, expect, test } from 'bun:test'
import { loadKeybindingsSync } from './loadUserBindings.js'
import { getBindingDisplayText } from './resolver.js'
import { getShortcutDisplay } from './shortcutFormat.js'

describe('getShortcutDisplay', () => {
  test('resolves a known default action to its configured chord, not the fallback', () => {
    // app:toggleTranscript / Global is a stable default binding (ctrl+o).
    const fallback = '__never_used_sentinel__'
    const result = getShortcutDisplay('app:toggleTranscript', 'Global', fallback)
    expect(result).not.toBe(fallback)
    expect(result.length).toBeGreaterThan(0)
    // Matches what the resolver computes directly from the loaded bindings.
    expect(result).toBe(
      getBindingDisplayText('app:toggleTranscript', 'Global', loadKeybindingsSync())!,
    )
  })

  test('returns the fallback for an action that has no binding', () => {
    const fallback = 'ctrl+shift+nonexistent'
    expect(
      getShortcutDisplay('app:thisActionDoesNotExist', 'Global', fallback),
    ).toBe(fallback)
  })

  test('returns the fallback for a known action in the wrong context', () => {
    const fallback = 'fallback-text'
    // toggleTranscript exists in Global, not in Autocomplete.
    expect(
      getShortcutDisplay('app:toggleTranscript', 'Autocomplete', fallback),
    ).toBe(fallback)
  })

  test('is stable across repeated calls (fallback-dedup does not throw)', () => {
    const fallback = 'fb'
    const first = getShortcutDisplay('app:noSuchAction', 'Global', fallback)
    const second = getShortcutDisplay('app:noSuchAction', 'Global', fallback)
    expect(first).toBe(fallback)
    expect(second).toBe(fallback)
  })
})
