import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js'
import { PowerShellTool } from './PowerShellTool.js'
import { POWERSHELL_TOOL_NAME } from './toolName.js'

const parent = { type: 'assistant' } as never

// call() reads only these fields. An agentId marks this as a non-main thread so
// the foreground path skips the main-thread cwd-reset (which needs full AppState).
function callCtx(): ToolUseContext {
  return {
    abortController: new AbortController(),
    agentId: 'a-test',
    setAppState: () => {},
    setToolJSX: () => {},
    toolUseId: 'tu-test',
  } as unknown as ToolUseContext
}

// checkPermissions reads only context.getAppState().toolPermissionContext.
function permCtx(allowRules: string[]): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    alwaysAllowRules: allowRules.length ? { session: allowRules } : {},
  }
  return {
    getAppState: () => ({ toolPermissionContext }),
  } as unknown as ToolUseContext
}

describe('PowerShellTool.call', () => {
  test('runs a trivial command and returns its stdout', async () => {
    const result = await PowerShellTool.call(
      { command: "Write-Output 'knightcode-ok'" },
      callCtx(),
      undefined as never,
      parent,
    )
    expect(result.data.interrupted).toBe(false)
    expect(result.data.stdout).toContain('knightcode-ok')
  })
})

describe('PowerShellTool.checkPermissions (prefix rules)', () => {
  test('an allow prefix rule permits a matching command', async () => {
    const rule = permissionRuleValueToString({
      toolName: POWERSHELL_TOOL_NAME,
      ruleContent: 'npm:*',
    })
    const decision = await PowerShellTool.checkPermissions(
      { command: 'npm run build' },
      permCtx([rule]),
    )
    expect(decision.behavior).toBe('allow')
  })

  test('without a matching rule the same command is not auto-allowed', async () => {
    const decision = await PowerShellTool.checkPermissions(
      { command: 'npm run build' },
      permCtx([]),
    )
    // No rule and not read-only → the engine defers to the harness
    // (passthrough/ask) rather than auto-allowing. The allow above is what the
    // prefix rule produced, proving rule matching drives the decision.
    expect(decision.behavior).not.toBe('allow')
  })
})
