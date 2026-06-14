// TODO: speculative bash-command classification (kicking off a background
// safety check for a shell command before the user is prompted) is not
// implemented yet. With no classifier wired up there is nothing to start, so
// this reports that no speculative check was launched.

import type { ToolPermissionContext } from '../../Tool.js'

export function startSpeculativeClassifierCheck(
  _command: string,
  _toolPermissionContext: ToolPermissionContext,
  _signal: AbortSignal,
  _isNonInteractiveSession: boolean,
): boolean {
  return false
}

/** Clears any in-flight speculative classifier checks. No-op until the
 *  classifier is wired up. */
export function clearSpeculativeChecks(): void {}

// TODO: command-prefix extraction for rule suggestions ("always allow `git`")
// depends on the bash parser / env-var safety tables that aren't ported. Until
// then no prefix is suggested and the rule UI falls back to the exact command.
export function getSimpleCommandPrefix(_command: string): string | null {
  return null
}

export function getFirstWordPrefix(_command: string): string | null {
  return null
}
