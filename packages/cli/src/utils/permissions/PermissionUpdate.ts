// TODO: applying permission-rule updates to the in-memory tool permission
// context and persisting them to settings files is not implemented yet — it
// depends on the settings persistence layer. These preserve the exact call
// surface the permission dispatch uses, returning the context unchanged and
// persisting nothing for now.

import { posix } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionRuleValue } from './PermissionRule.js'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from './PermissionUpdateSchema.js'
import { toPosixPath } from './filesystem.js'

// Build an "always allow reads under this directory" rule suggestion. Used by
// the Bash tool's path validator to offer a Read allowlist entry for a dir.
export function createReadRuleSuggestion(
  dirPath: string,
  destination: PermissionUpdateDestination = 'session',
): PermissionUpdate | undefined {
  const pathForPattern = toPosixPath(dirPath)
  if (pathForPattern === '/') {
    return undefined
  }
  const ruleContent = posix.isAbsolute(pathForPattern)
    ? `/${pathForPattern}/**`
    : `${pathForPattern}/**`
  return {
    type: 'addRules',
    rules: [{ toolName: 'Read', ruleContent }],
    behavior: 'allow',
    destination,
  }
}

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

// Flatten the rule values carried by a set of permission updates.
export function extractRules(
  updates: PermissionUpdate[] | undefined,
): PermissionRuleValue[] {
  if (!updates) return []
  return updates.flatMap(u =>
    u.type === 'addRules' || u.type === 'replaceRules' ? u.rules : [],
  )
}

export function hasRules(updates: PermissionUpdate[] | undefined): boolean {
  return extractRules(updates).length > 0
}

// Persist a single permission update (singular convenience over the batch form).
export function persistPermissionUpdate(update: PermissionUpdate): void {
  persistPermissionUpdates([update])
}

// TODO: full persistence-destination gating lands with settings; treat every
// destination as persistable so the "always allow" option stays available.
export function supportsPersistence(_destination: unknown): boolean { return true }
