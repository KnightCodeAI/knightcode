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

export type AutoModeUnavailableReason = 'settings' | 'circuit-breaker' | 'model'

// TODO: auto mode is an account-backed permission tier; a BYOK build has no
// auto-mode gate, so it is permanently unavailable and the gate is off.
export function isAutoModeGateEnabled(): boolean {
  return false
}

export function getAutoModeUnavailableReason(): AutoModeUnavailableReason | null {
  return 'settings'
}

// Apply a permission-mode change. Auto/plan-mode side effects (classifier
// activation, beta headers, dangerous-rule stripping) belong to the hosted
// permission system and are inert here; the mode change itself is reflected by
// the caller, so the context passes through unchanged.
export function transitionPermissionMode(
  _fromMode: string,
  _toMode: string,
  context: ToolPermissionContext,
): ToolPermissionContext {
  return context
}
