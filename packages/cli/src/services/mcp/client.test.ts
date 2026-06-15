import { describe, expect, it } from 'bun:test'
import { fetchToolsForClient } from './client.js'
import { isMcpTool } from './utils.js'
import type { MCPServerConnection } from './types.js'

// A minimal connected server whose underlying SDK client answers tools/list
// with one tool — enough to exercise the discover-and-wrap path without a
// real transport.
function fakeConnectedServer(): MCPServerConnection {
  return {
    name: 'github',
    type: 'connected',
    config: { type: 'http', url: 'https://mcp.example.com', scope: 'user' },
    capabilities: { tools: {} },
    client: {
      request: async () => ({
        tools: [{ name: 'search', description: 'Search repositories' }],
      }),
    },
  } as unknown as MCPServerConnection
}

describe('fetchToolsForClient', () => {
  it('wraps server tools with the mcp__ prefix and MCP identity', async () => {
    const tools = await fetchToolsForClient(fakeConnectedServer())
    expect(tools.length).toBe(1)
    const [tool] = tools
    expect(tool!.name).toBe('mcp__github__search')
    expect(isMcpTool(tool!)).toBe(true)
    expect(await tool!.description?.({} as never, {} as never)).toContain(
      'Search repositories',
    )
  })

  it('returns no tools for a server that never connected', async () => {
    const failed = {
      name: 'down',
      type: 'failed',
      config: { type: 'http', url: 'x', scope: 'user' },
    } as unknown as MCPServerConnection
    expect(await fetchToolsForClient(failed)).toEqual([])
  })
})
