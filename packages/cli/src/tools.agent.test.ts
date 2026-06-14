import { describe, expect, test } from 'bun:test'
import { getTools } from './tools.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import { AGENT_TOOL_NAME } from './tools/AgentTool/constants.js'

describe('Agent tool registration', () => {
  test('the Agent tool is present in the assembled tool pool', () => {
    const names = getTools(getEmptyToolPermissionContext()).map(t => t.name)
    expect(names).toContain(AGENT_TOOL_NAME)
  })
})
