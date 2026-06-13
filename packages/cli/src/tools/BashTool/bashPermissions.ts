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
