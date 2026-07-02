// Maps headless (--print) CLI flags onto a ToolPermissionContext. This only
// builds the context object — the actual allow/deny decision at tool-call
// time remains the existing hasPermissionsToUseTool engine
// (src/utils/permissions/permissions.ts), passed as canUseTool. Deny-wins-
// over-allow and all other precedence rules are enforced there, not here.

import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../Tool.js'
import type { PermissionMode } from '../types/permissions.js'

export type HeadlessPermissionOptions = {
  permissionMode?: PermissionMode
  dangerouslySkipPermissions: boolean
  allowedTools: string[]
  disallowedTools: string[]
}

/**
 * Builds a ToolPermissionContext from headless CLI flags (--permission-mode,
 * --dangerously-skip-permissions, --allowedTools, --disallowedTools).
 * Mirrors upstream print-mode semantics: allowed/disallowed tool rules are
 * recorded under the 'cliArg' source, same as --allowedTools/--disallowedTools
 * do for interactive sessions (see runAgent.ts's alwaysAllowRules.cliArg).
 */
export function buildHeadlessPermissionContext(
  opts: HeadlessPermissionOptions,
): ToolPermissionContext {
  const context = getEmptyToolPermissionContext()

  const mode: PermissionMode = opts.dangerouslySkipPermissions
    ? 'bypassPermissions'
    : (opts.permissionMode ?? 'default')

  return {
    ...context,
    mode,
    alwaysAllowRules:
      opts.allowedTools.length > 0
        ? { ...context.alwaysAllowRules, cliArg: [...opts.allowedTools] }
        : context.alwaysAllowRules,
    alwaysDenyRules:
      opts.disallowedTools.length > 0
        ? { ...context.alwaysDenyRules, cliArg: [...opts.disallowedTools] }
        : context.alwaysDenyRules,
  }
}
