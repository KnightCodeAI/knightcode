import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod/v4'
import type { MCPServerConnection } from '../types.js'

/**
 * Stand up a minimal in-memory MCP server exposing one tool (`echo`) and one
 * resource, connect a real SDK client to it over a linked transport pair, and
 * return a `ConnectedMCPServer` shaped exactly like the connection layer
 * produces. Lets the real discover/wrap code run end-to-end without spawning a
 * subprocess.
 */
export async function connectEchoServer(
  name = 'echo-server',
): Promise<MCPServerConnection> {
  const server = new McpServer({ name, version: '1.0.0' })

  server.registerTool(
    'echo',
    {
      description: 'Echo back the provided text',
      // zod/v4 raw shape; cast at the SDK boundary (it accepts both zod surfaces).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: { text: z.string() } as any,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async ({ text }: { text: string }) => ({
      content: [{ type: 'text', text }],
    })) as any,
  )

  server.registerResource(
    'greeting',
    'echo://greeting',
    { description: 'A static greeting resource' },
    async () => ({
      contents: [
        { uri: 'echo://greeting', mimeType: 'text/plain', text: 'hello' },
      ],
    }),
  )

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)

  return {
    name,
    type: 'connected',
    client,
    capabilities: client.getServerCapabilities() ?? {},
    config: { type: 'sse', url: 'inmemory://echo', scope: 'user' },
    cleanup: async () => {
      await client.close()
      await server.close()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}
