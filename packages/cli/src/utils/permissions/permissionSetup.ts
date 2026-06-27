// Auto-mode permission setup: gate availability, plan/auto transitions, and
// stripping of blanket allow rules that would otherwise bypass the classifier.
// In this BYOK build auto mode is always available (the user owns their key), so
// the gate is on and the bypass-mode killswitch stays inert.

import type { PermissionRule } from './PermissionRule.js'
import type {
  PermissionRuleSource,
  PermissionRuleValue,
} from './PermissionRule.js'
import type {
  ToolPermissionContext,
  ToolPermissionRulesBySource,
} from '../../Tool.js'
import { getInitialSettings } from '../settings/settings.js'
import { setAutoModeActive } from './autoModeState.js'

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

// In this BYOK build the user supplies their own key/model, so auto mode is
// always available — there is no hosted circuit breaker to consult.
export function isAutoModeGateEnabled(): boolean {
  return true
}

export function getAutoModeUnavailableReason(): AutoModeUnavailableReason | null {
  return null
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
    ? `${base} · #knightcode-code-feedback`
    : base
}

// Apply a permission-mode change. Entering auto mode activates the classifier
// (via the session flag consulted by permissions.ts) and strips blanket
// always-allow rules that would otherwise let tool calls skip classification;
// leaving auto mode deactivates the classifier.
export function transitionPermissionMode(
  fromMode: string,
  toMode: string,
  context: ToolPermissionContext,
): ToolPermissionContext {
  if (toMode === 'auto' && fromMode !== 'auto') {
    setAutoModeActive(true)
    return stripDangerousPermissionsForAutoMode(context)
  }
  if (fromMode === 'auto' && toMode !== 'auto') {
    setAutoModeActive(false)
  }
  return context
}

// Blanket always-allow rules that would let a tool call bypass the auto-mode
// classifier entirely. Matched as whole rules ("Bash") or catch-all content
// ("Bash(*)"); narrower prefix rules (e.g. "Bash(npm run:*)") are preserved.
const DANGEROUS_ALLOW_RULES = new Set<string>([
  'Bash',
  'Bash(*)',
  'Bash(:*)',
  'PowerShell',
  'PowerShell(*)',
  'PowerShell(:*)',
])

// Remove blanket allow rules from every source so auto mode actually runs the
// classifier on shell tools. Returns the same reference when nothing changed so
// callers can skip needless state updates.
export function stripDangerousPermissionsForAutoMode(
  context: ToolPermissionContext,
): ToolPermissionContext {
  let changed = false
  const next: ToolPermissionRulesBySource = {}
  for (const [source, rules] of Object.entries(context.alwaysAllowRules)) {
    if (!rules) continue
    const kept = rules.filter(rule => !DANGEROUS_ALLOW_RULES.has(rule))
    if (kept.length !== rules.length) changed = true
    next[source as PermissionRuleSource] = kept
  }
  if (!changed) return context
  return { ...context, alwaysAllowRules: next }
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

// Auto mode is always enabled in this build; the circuit-breaker 'disabled'
// state only exists for the hosted gate, which we don't consult here.
export function getAutoModeEnabledState(): 'enabled' | 'disabled' {
  return 'enabled'
}

// Whether the user has opted into auto mode via any persisted source. The opt-in
// dialog writes skipAutoPermissionPrompt, which is our single source of truth.
export function hasAutoModeOptInAnySource(): boolean {
  return getInitialSettings().skipAutoPermissionPrompt === true
}

export async function shouldDisableBypassPermissions(..._args: unknown[]): Promise<boolean> { return false }

// Called once at boot and on model/fastMode change. Marks auto mode available on
// the permission context so the Shift+Tab carousel includes it. The transform is
// applied to the live context by the caller (see bypassPermissionsKillswitch).
export async function verifyAutoModeGateAccess(
  ..._args: unknown[]
): Promise<{
  updateContext: (ctx: ToolPermissionContext) => ToolPermissionContext
  notification: string | null
}> {
  const available = isAutoModeGateEnabled()
  return {
    updateContext: (ctx: ToolPermissionContext) =>
      ctx.isAutoModeAvailable === available
        ? ctx
        : { ...ctx, isAutoModeAvailable: available },
    notification: null,
  }
}
