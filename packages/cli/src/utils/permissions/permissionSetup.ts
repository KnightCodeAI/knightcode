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

export function getAutoModeUnavailableNotification(
  reason: AutoModeUnavailableReason,
): string {
  let base: string
  switch (reason) {
    case 'settings':
      base = 'auto mode disabled by settings'
      break
    case 'circuit-breaker':
      base = 'auto mode is unavailable for your plan'
      break
    case 'model':
      base = 'auto mode unavailable for this model'
      break
  }
  return process.env.USER_TYPE === 'ant'
    ? `${base} · #claude-code-feedback`
    : base
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

// TODO: dangerous-rule stripping/restoring is part of the auto-mode permission
// flow, which is inert in this build (see neighbors). Both pass the context
// through unchanged.
export function stripDangerousPermissionsForAutoMode(
  context: ToolPermissionContext,
): ToolPermissionContext {
  return context
}

export function restoreDangerousPermissions(
  context: ToolPermissionContext,
): ToolPermissionContext {
  return context
}

// Records the mode to restore when leaving plan mode. The auto-mode plan
// handling runs behind a transcript-classifier gate that is off in this build,
// so plan entry just preserves the prior mode in prePlanMode.
export function prepareContextForPlanMode(
  context: ToolPermissionContext,
): ToolPermissionContext {
  if (context.mode === 'plan') return context
  return { ...context, prePlanMode: context.mode }
}

// Parse a CLI --allowedTools/--disallowedTools list into tool names.
export function parseToolListFromCLI(tools: string[]): string[] {
  return tools.flatMap(t => t.split(',')).map(t => t.trim()).filter(Boolean)
}

// TODO: auto-accept ("auto mode") opt-in lands with its permission flow; off in a BYOK build.
export function getAutoModeEnabledState(): any { return { enabled: false } }
export function hasAutoModeOptInAnySource(): boolean { return false }

export async function shouldDisableBypassPermissions(..._args: unknown[]): Promise<boolean> { return false }
export async function verifyAutoModeGateAccess(
  ..._args: unknown[]
): Promise<{ updateContext: (ctx: any) => any; notification: any }> {
  return { updateContext: ctx => ctx, notification: null }
}
