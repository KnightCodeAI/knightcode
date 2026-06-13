// TODO: reading and writing permission rules from settings files is not
// implemented yet — it depends on the settings persistence layer. These
// preserve the exact call surface the permission dispatch uses. With no
// editable settings wired up, no managed-only restriction applies and no rule
// is ever deleted.

import type { EditableSettingSource } from '../settings/constants.js'
import type { PermissionRule } from './PermissionRule.js'

export type PermissionRuleFromEditableSettings = PermissionRule & {
  source: EditableSettingSource
}

export function shouldAllowManagedPermissionRulesOnly(): boolean {
  return false
}

export function deletePermissionRuleFromSettings(
  _rule: PermissionRuleFromEditableSettings,
): boolean {
  return false
}

// No on-disk rules until the settings persistence layer is wired up.
export function loadAllPermissionRulesFromDisk(): PermissionRule[] {
  return []
}
