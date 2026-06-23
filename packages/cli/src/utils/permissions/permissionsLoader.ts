// Reads permission rules (allow/deny/ask) from the per-source settings files via
// getSettingsForSource. Writing rules (deletePermissionRuleFromSettings,
// persisting "always allow") still depends on updateSettingsForSource, which is
// not wired up yet, so deletion remains a no-op.

import type { EditableSettingSource, SettingSource } from '../settings/constants.js'
import { getEnabledSettingSources } from '../settings/constants.js'
import { getSettingsForSource } from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import { permissionRuleValueFromString } from './permissionRuleParser.js'
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
} from './PermissionRule.js'

export type PermissionRuleFromEditableSettings = PermissionRule & {
  source: EditableSettingSource
}

const SUPPORTED_RULE_BEHAVIORS = [
  'allow',
  'deny',
  'ask',
] as const satisfies PermissionBehavior[]

// KnightCode has no policySettings (managed/admin) file, so managed-only mode is
// never active. Kept as a function for call-surface parity with upstream.
export function shouldAllowManagedPermissionRulesOnly(): boolean {
  return false
}

// Writing/deleting rules depends on updateSettingsForSource (not yet wired).
export function deletePermissionRuleFromSettings(
  _rule: PermissionRuleFromEditableSettings,
): boolean {
  return false
}

function settingsJsonToRules(
  data: SettingsJson | null,
  source: PermissionRuleSource,
): PermissionRule[] {
  if (!data || !data.permissions) return []
  const { permissions } = data
  const rules: PermissionRule[] = []
  for (const behavior of SUPPORTED_RULE_BEHAVIORS) {
    const behaviorArray = permissions[behavior]
    if (behaviorArray) {
      for (const ruleString of behaviorArray) {
        rules.push({
          source,
          ruleBehavior: behavior,
          ruleValue: permissionRuleValueFromString(ruleString),
        })
      }
    }
  }
  return rules
}

// Loads all permission rules from every enabled settings source.
export function loadAllPermissionRulesFromDisk(): PermissionRule[] {
  if (shouldAllowManagedPermissionRulesOnly()) {
    return getPermissionRulesForSource('policySettings')
  }
  const rules: PermissionRule[] = []
  for (const source of getEnabledSettingSources()) {
    rules.push(...getPermissionRulesForSource(source))
  }
  return rules
}

// Whether the permission dialog should offer "always allow" rule options.
// Suppressed when only managed (admin-pushed) rules are allowed.
export function shouldShowAlwaysAllowOptions(): boolean {
  return !shouldAllowManagedPermissionRulesOnly()
}

// Loads permission rules from a specific settings source.
export function getPermissionRulesForSource(
  source: SettingSource,
): PermissionRule[] {
  return settingsJsonToRules(getSettingsForSource(source), source)
}
