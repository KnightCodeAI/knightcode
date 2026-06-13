import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { getEmptyToolPermissionContext, type Tool } from '../../Tool.js'
import { checkReadPermissionForTool } from './filesystem.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'
import { createReadRuleSuggestion } from './permissionSuggestions.js'
import { matchWildcardPattern } from './shellRuleMatching.js'

// A minimal Read-like tool: the permission checks only touch name + getPath.
const readTool = {
  name: 'Read',
  getPath: (input: { file_path: string }) => input.file_path,
} as unknown as Tool

describe('permission rule parsing', () => {
  test('round-trips a tool(content) rule string', () => {
    const value = permissionRuleValueFromString('Bash(git *)')
    expect(value.toolName).toBe('Bash')
    expect(value.ruleContent).toBe('git *')
    expect(permissionRuleValueToString(value)).toBe('Bash(git *)')
  })

  test('parses a bare tool name with no content', () => {
    const value = permissionRuleValueFromString('Read')
    expect(value.toolName).toBe('Read')
    expect(value.ruleContent).toBeUndefined()
  })
})

describe('matchWildcardPattern', () => {
  test('matches a trailing-wildcard prefix', () => {
    expect(matchWildcardPattern('git *', 'git status')).toBe(true)
  })

  test('rejects a non-matching command', () => {
    expect(matchWildcardPattern('git *', 'npm install')).toBe(false)
  })
})

describe('checkReadPermissionForTool', () => {
  const filePath = join(process.cwd(), 'some-file-under-cwd.ts')

  test('allows reads inside the working directory by default', () => {
    const decision = checkReadPermissionForTool(
      readTool,
      { file_path: filePath },
      getEmptyToolPermissionContext(),
    )
    expect(decision.behavior).toBe('allow')
  })

  test('a matching deny rule overrides the working-directory allow', () => {
    // Build a correctly-formatted deny rule covering the whole cwd subtree.
    const suggestion = createReadRuleSuggestion(process.cwd())
    if (suggestion?.type !== 'addRules') {
      throw new Error('expected an addRules suggestion for cwd')
    }
    const rule = suggestion.rules[0]
    if (!rule) throw new Error('expected at least one rule')
    const ruleString = permissionRuleValueToString({
      toolName: 'Read',
      ruleContent: rule.ruleContent,
    })

    const context = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { session: [ruleString] },
    }
    const decision = checkReadPermissionForTool(
      readTool,
      { file_path: filePath },
      context,
    )
    expect(decision.behavior).toBe('deny')
  })
})
