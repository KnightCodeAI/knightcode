import { describe, expect, it } from 'bun:test'
import { ListMcpResourcesTool } from './ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from './ReadMcpResourceTool/ReadMcpResourceTool.js'
import { MCPTool } from './MCPTool/MCPTool.js'
import { createMcpAuthTool } from './McpAuthTool/McpAuthTool.js'
import type { ScopedMcpServerConfig } from '../services/mcp/types.js'

describe('MCP resource tools', () => {
  it('expose the expected tool names', () => {
    expect(ListMcpResourcesTool.name).toBe('ListMcpResourcesTool')
    expect(ReadMcpResourceTool.name).toBe('ReadMcpResourceTool')
  })

  it('the MCP tool wrapper carries the mcp identity', () => {
    expect(MCPTool.name).toBe('mcp')
  })
})

describe('createMcpAuthTool', () => {
  it('builds a per-server, prefixed auth tool', () => {
    const config = {
      type: 'http',
      url: 'https://mcp.example.com/sse',
      scope: 'user',
    } as unknown as ScopedMcpServerConfig
    const tool = createMcpAuthTool('github', config)
    expect(tool.name).toBe('mcp__github__authenticate')
    expect(tool.isMcp).toBe(true)
  })
})
