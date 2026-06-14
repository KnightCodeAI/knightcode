import { describe, expect, test } from 'bun:test'
import { BashTool } from './BashTool.js'
import { BASH_TOOL_NAME } from './toolName.js'

describe('BashTool', () => {
  test('name matches the reference Bash tool name', () => {
    expect(BashTool.name).toBe(BASH_TOOL_NAME)
    expect(BashTool.name).toBe('Bash')
  })

  test('exposes an input schema', () => {
    expect(BashTool.inputSchema).toBeDefined()
  })

  test('classifies a known read-only command as read-only', () => {
    expect(BashTool.isReadOnly?.({ command: 'git status' })).toBe(true)
  })

  test('classifies a mutating command as not read-only', () => {
    expect(BashTool.isReadOnly?.({ command: 'rm -rf /tmp/x' })).toBe(false)
  })
})
