// TODO: user keybinding resolution lands with the keybindings phase. Until the
// bindings loader exists, the shortcut display falls back to the caller's
// provided default text.

import type { KeybindingContextName } from './types.js'

export function getShortcutDisplay(
  _action: string,
  _context: KeybindingContextName,
  fallback: string,
): string {
  return fallback
}
