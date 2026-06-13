// TODO: the full permission setup (auto-mode entry, dangerous-rule stripping,
// bypass-mode gating, plan-auto-mode transitions) lands with the permission
// dialogs. These are honest no-ops/identities so the AppState provider and the
// settings-apply path mount and run; they never strip or gate today.

import type { PermissionRule } from './PermissionRule.js'
import type {
  PermissionRuleSource,
  PermissionRuleValue,
} from './PermissionRule.js'
import type { ToolPermissionContext } from '../../Tool.js'

export type DangerousPermissionInfo = {
  ruleValue: PermissionRuleValue
  source: PermissionRuleSource
  ruleDisplay: string
  sourceDisplay: string
}

export function isBypassPermissionsModeDisabled(): boolean {
  return false
}

export function createDisabledBypassPermissionsContext(
  currentContext: ToolPermissionContext,
): ToolPermissionContext {
  return currentContext
}

export function findOverlyBroadBashPermissions(
  _rules: PermissionRule[],
  _cliAllowedTools: string[],
): DangerousPermissionInfo[] {
  return []
}

export function removeDangerousPermissions(
  context: ToolPermissionContext,
  _dangerousPermissions: DangerousPermissionInfo[],
): ToolPermissionContext {
  return context
}

export function transitionPlanAutoMode(
  context: ToolPermissionContext,
): ToolPermissionContext {
  return context
}
