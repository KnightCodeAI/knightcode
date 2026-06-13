// TODO: MCP instruction deltas are not implemented yet (no MCP servers
// connect in this build). The announce gate is off, so the attachment caller
// never reaches getMcpInstructionsDelta; it reports no delta.

import type { Message } from '../types/message.js'
import type { MCPServerConnection } from '../services/mcp/types.js'

export type McpInstructionsDelta = {
  addedNames: string[]
  addedBlocks: string[]
  removedNames: string[]
}

export type ClientSideInstruction = {
  serverName: string
  block: string
}

export function isMcpInstructionsDeltaEnabled(): boolean {
  return false
}

export function getMcpInstructionsDelta(
  _mcpClients: MCPServerConnection[],
  _messages: Message[],
  _clientSideInstructions: ClientSideInstruction[],
): McpInstructionsDelta | null {
  return null
}
