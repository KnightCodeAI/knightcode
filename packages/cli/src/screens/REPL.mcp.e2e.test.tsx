import { afterEach, describe, expect, test } from 'bun:test'
import {
  fetchToolsForClient,
  fetchResourcesForClient,
} from '../services/mcp/client.js'
import { assembleToolPool, getTools } from '../tools.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { isMcpTool } from '../services/mcp/utils.js'
import { connectEchoServer } from '../services/mcp/__fixtures__/echoServer.js'
import type { MCPServerConnection } from '../services/mcp/types.js'

let connection: MCPServerConnection | undefined

afterEach(async () => {
  if (connection?.type === 'connected') await connection.cleanup()
  connection = undefined
})

describe('MCP end-to-end (in-memory server)', () => {
  test('discovers and wraps a server tool into the tool pool', async () => {
    connection = await connectEchoServer()

    const mcpTools = await fetchToolsForClient(connection)
    const echo = mcpTools.find(t => t.name === 'mcp__echo-server__echo')
    expect(echo).toBeDefined()
    expect(isMcpTool(echo!)).toBe(true)

    // The wrapped MCP tool interleaves into the assembled pool alongside the
    // built-in suite (which already carries the resource + skill tools).
    const pool = assembleToolPool(getEmptyToolPermissionContext(), mcpTools)
    const names = pool.map(t => t.name)
    expect(names).toContain('mcp__echo-server__echo')
    expect(names).toContain('ListMcpResourcesTool')
    expect(names).toContain('Bash')
  })

  test('surfaces a server resource through the resource discovery path', async () => {
    connection = await connectEchoServer()
    const resources = await fetchResourcesForClient(connection)
    const greeting = resources.find(r => r.uri === 'echo://greeting')
    expect(greeting).toBeDefined()
    expect(greeting!.server).toBe('echo-server')
  })

  test('the base tool pool exposes the MCP resource tools', () => {
    const names = getTools(getEmptyToolPermissionContext()).map(t => t.name)
    expect(names).toContain('ListMcpResourcesTool')
    expect(names).toContain('ReadMcpResourceTool')
  })
})
