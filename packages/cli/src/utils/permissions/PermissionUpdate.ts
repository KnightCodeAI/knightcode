// TODO: applying permission-rule updates to the in-memory tool permission
// context and persisting them to settings files is not implemented yet — it
// depends on the settings persistence layer. These preserve the exact call
// surface the permission dispatch uses, returning the context unchanged and
// persisting nothing for now.

import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionUpdate } from './PermissionUpdateSchema.js'

export function applyPermissionUpdate(
  context: ToolPermissionContext,
  _update: PermissionUpdate,
): ToolPermissionContext {
  return context
}

export function applyPermissionUpdates(
  context: ToolPermissionContext,
  _updates: PermissionUpdate[],
): ToolPermissionContext {
  return context
}

export function persistPermissionUpdates(_updates: PermissionUpdate[]): void {}
