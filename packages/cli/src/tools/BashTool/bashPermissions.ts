// TODO: speculative bash-command classification (kicking off a background
// safety check for a shell command before the user is prompted) is not
// implemented yet. With no classifier wired up there is nothing to start, so
// this reports that no speculative check was launched.

import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import {
  matchWildcardPattern as sharedMatchWildcardPattern,
  permissionRuleExtractPrefix as sharedPermissionRuleExtractPrefix,
} from '../../utils/permissions/shellRuleMatching.js'
import type { BashTool } from './BashTool.js'
import type { z } from 'zod/v4'

export function startSpeculativeClassifierCheck(
  _command: string,
  _toolPermissionContext: ToolPermissionContext,
  _signal: AbortSignal,
  _isNonInteractiveSession: boolean,
): boolean {
  return false
}

/** Clears any in-flight speculative classifier checks. No-op until the
 *  classifier is wired up. */
export function clearSpeculativeChecks(): void {}

// TODO: command-prefix extraction for rule suggestions ("always allow `git`")
// depends on the bash parser / env-var safety tables that aren't ported. Until
// then no prefix is suggested and the rule UI falls back to the exact command.
export function getSimpleCommandPrefix(_command: string): string | null {
  return null
}

export function getFirstWordPrefix(_command: string): string | null {
  return null
}

// TODO: bash-command classifier auto-approval (feature-gated). With the
// classifier disabled, no speculative check is ever started or consumed.
export async function executeAsyncClassifierCheck(..._args: unknown[]): Promise<any> { return null }
export async function awaitClassifierAutoApproval(..._args: unknown[]): Promise<any> { return null }
export function consumeSpeculativeClassifierCheck(..._args: unknown[]): any { return null }
export function peekSpeculativeClassifierCheck(..._args: unknown[]): any { return null }

// Rule-pattern matching is independent of the tree-sitter parser — re-export the
// shared real implementations so allow/deny rules still match command prefixes.
export const matchWildcardPattern = sharedMatchWildcardPattern
export const permissionRuleExtractPrefix = sharedPermissionRuleExtractPrefix

// TODO: the full AST-driven command permission check (compound-command safety,
// path validation, cd handling) depends on the tree-sitter parser, which is out
// of scope. Until it lands, every Bash command is routed to the permission
// prompt — safe (never auto-allows) but more conservative than prefix rules.
export async function bashToolHasPermission(
  _input: z.infer<typeof BashTool.inputSchema>,
  _context: ToolUseContext,
): Promise<PermissionResult> {
  return {
    behavior: 'ask',
    message: 'This command requires your approval to run.',
  }
}

// TODO: compound-cd detection depends on the command parser. Without it, report
// no cd (path validation already degrades to prompting).
export function commandHasAnyCd(_command: string): boolean {
  return false
}

// TODO: safe-wrapper stripping (timeout/time/nohup/env …) depends on the parser
// rules; until ported, leave the command unchanged so validators see it raw.
export function stripSafeWrappers(command: string): string {
  return command
}

// Recognize git commands by their leading token. Full normalization (xargs git,
// wrappers) needs the parser; the fast path covers the common case.
export function isNormalizedGitCommand(command: string): boolean {
  const trimmed = command.trimStart()
  return trimmed === 'git' || trimmed.startsWith('git ')
}
