import { describe, expect, test } from 'bun:test'
import { AgentTool } from './AgentTool.js'
import { AGENT_TOOL_NAME } from './constants.js'
import { renderToolUseMessage } from './UI.js'

describe('AgentTool', () => {
  test('name matches the reference Agent tool name', () => {
    expect(AgentTool.name).toBe(AGENT_TOOL_NAME)
    expect(AgentTool.name).toBe('Agent')
  })

  test('exposes an input schema', () => {
    expect(AgentTool.inputSchema).toBeDefined()
  })

  test('renderToolUseMessage renders the task description', () => {
    const rendered = renderToolUseMessage({
      description: 'Explore the repo',
      prompt: 'List the top-level packages',
    })
    expect(rendered).toBe('Explore the repo')
  })
})
