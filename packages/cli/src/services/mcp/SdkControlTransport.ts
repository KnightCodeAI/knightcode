import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

// TODO: SDK-process MCP transport bridge is not ported — this build runs no
// SDK host process, so SDK MCP servers (transport type "sdk") are never
// connected. The transport classes preserve their shape but fail loudly if a
// "sdk" server config somehow reaches the connection layer.

export type SendMcpMessageCallback = (
  serverName: string,
  message: JSONRPCMessage,
) => Promise<JSONRPCMessage>

export class SdkControlClientTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(
    private serverName: string,
    private sendMcpMessage: SendMcpMessageCallback,
  ) {}

  async start(): Promise<void> {
    throw new Error('SDK MCP transport is not supported')
  }

  async send(_message: JSONRPCMessage): Promise<void> {
    throw new Error('SDK MCP transport is not supported')
  }

  async close(): Promise<void> {
    this.onclose?.()
  }
}

export class SdkControlServerTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(private sendMcpMessage: (message: JSONRPCMessage) => void) {}

  async start(): Promise<void> {
    throw new Error('SDK MCP transport is not supported')
  }

  async send(_message: JSONRPCMessage): Promise<void> {
    throw new Error('SDK MCP transport is not supported')
  }

  async close(): Promise<void> {
    this.onclose?.()
  }
}
