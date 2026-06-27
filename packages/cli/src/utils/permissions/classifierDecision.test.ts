import { describe, expect, test } from 'bun:test'
import { isAutoModeAllowlistedTool } from './classifierDecision.js'

describe('isAutoModeAllowlistedTool', () => {
  test('read-only tools are allowlisted (skip the classifier)', () => {
    for (const name of ['Read', 'Glob', 'Grep', 'NotebookRead', 'TaskList']) {
      expect(isAutoModeAllowlistedTool(name)).toBe(true)
    }
  })

  test('mutating / side-effecting tools are not allowlisted', () => {
    for (const name of ['Bash', 'PowerShell', 'Write', 'Edit', 'WebFetch']) {
      expect(isAutoModeAllowlistedTool(name)).toBe(false)
    }
  })

  test('unknown tools are not allowlisted', () => {
    expect(isAutoModeAllowlistedTool('SomeMcpTool')).toBe(false)
  })
})
