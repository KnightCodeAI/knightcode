// TODO: speculative bash-command classification (kicking off a background
// safety check for a shell command before the user is prompted) is not
// implemented yet. With no classifier wired up there is nothing to start, so
// this reports that no speculative check was launched.

import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import {
  hasWildcards,
  matchWildcardPattern as sharedMatchWildcardPattern,
  permissionRuleExtractPrefix as sharedPermissionRuleExtractPrefix,
} from '../../utils/permissions/shellRuleMatching.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../../utils/permissions/permissionRuleParser.js'
import type {
  PermissionRule,
  PermissionRuleSource,
} from '../../types/permissions.js'
import { BASH_TOOL_NAME } from './toolName.js'
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

// Shell metacharacters that chain, substitute, redirect, group, or background
// commands. Without the tree-sitter parser (out of scope) we cannot statically
// determine everything a command containing these would run, so such commands
// are NEVER auto-allowed — e.g. an allow rule `Bash(npm test:*)` must not green-
// light `npm test && rm -rf /`. Deny rules still apply to them.
const SHELL_METACHARACTERS = /[;&|`$<>(){}\n]/

// True if `command` is matched by a Bash permission rule's content.
// - undefined content (bare `Bash` rule) matches any command
// - `prefix:*` (legacy) matches the prefix or prefix followed by a space
// - patterns with `*` use wildcard matching
// - otherwise an exact-string match is required
function bashRuleMatchesCommand(
  ruleContent: string | undefined,
  command: string,
): boolean {
  if (ruleContent === undefined) return true
  const pattern = ruleContent.trim()
  if (pattern === '') return false
  if (pattern === command) return true
  const prefix = sharedPermissionRuleExtractPrefix(pattern)
  if (prefix !== null) {
    return command === prefix || command.startsWith(`${prefix} `)
  }
  if (hasWildcards(pattern)) {
    return sharedMatchWildcardPattern(pattern, command)
  }
  return false
}

// Collects Bash rules from a per-source rule map into full PermissionRule objects.
function bashRulesFromSourceMap(
  rulesBySource: Readonly<Partial<Record<PermissionRuleSource, readonly string[]>>>,
  ruleBehavior: 'allow' | 'deny',
): PermissionRule[] {
  const rules: PermissionRule[] = []
  for (const [source, ruleStrings] of Object.entries(rulesBySource)) {
    for (const ruleString of ruleStrings ?? []) {
      const ruleValue = permissionRuleValueFromString(ruleString)
      if (ruleValue.toolName === BASH_TOOL_NAME) {
        rules.push({
          source: source as PermissionRuleSource,
          ruleBehavior,
          ruleValue,
        })
      }
    }
  }
  return rules
}

// Evaluates a Bash command against the configured allow/deny rules. Deny rules
// take precedence and apply to every command; allow rules only auto-approve a
// single simple command (no shell metacharacters). Anything else falls through
// to the permission prompt — safe by construction.
//
// Note: the full AST-driven analysis (compound-command decomposition, path
// validation, cd handling) still depends on the tree-sitter parser, which is
// out of scope; this is the conservative subset that honors prefix/exact/
// wildcard rules without it.
export async function bashToolHasPermission(
  input: z.infer<typeof BashTool.inputSchema>,
  context: ToolUseContext,
): Promise<PermissionResult> {
  const command = (input.command ?? '').trim()
  const { toolPermissionContext } = context.getAppState()

  // 1. Deny rules win and apply even to compound commands.
  for (const rule of bashRulesFromSourceMap(
    toolPermissionContext.alwaysDenyRules,
    'deny',
  )) {
    if (bashRuleMatchesCommand(rule.ruleValue.ruleContent, command)) {
      return {
        behavior: 'deny',
        message: `Permission to run this command was denied by rule "${permissionRuleValueToString(
          rule.ruleValue,
        )}".`,
        decisionReason: { type: 'rule', rule },
      }
    }
  }

  // 2. Only auto-allow a single simple command we can fully vouch for.
  if (!SHELL_METACHARACTERS.test(command)) {
    for (const rule of bashRulesFromSourceMap(
      toolPermissionContext.alwaysAllowRules,
      'allow',
    )) {
      if (bashRuleMatchesCommand(rule.ruleValue.ruleContent, command)) {
        return { behavior: 'allow', decisionReason: { type: 'rule', rule } }
      }
    }
  }

  // 3. Default: prompt the user.
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
