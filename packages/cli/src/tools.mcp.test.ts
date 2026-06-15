import { describe, expect, it } from 'bun:test'
import { getTools, getAllBaseTools } from './tools.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import { isToolSearchEnabledOptimistic } from './utils/toolSearch.js'

describe('MCP tool registration', () => {
  it('exposes the MCP resource tools in the pool', () => {
    const names = getTools(getEmptyToolPermissionContext()).map(t => t.name)
    expect(names).toContain('ListMcpResourcesTool')
    expect(names).toContain('ReadMcpResourceTool')
  })

  it('gates ToolSearch on the optimistic tool-search check', () => {
    const names = getAllBaseTools().map(t => t.name)
    // The deferred-tool search tool is present iff tool search might be enabled.
    expect(names.includes('ToolSearch')).toBe(isToolSearchEnabledOptimistic())
  })
})
