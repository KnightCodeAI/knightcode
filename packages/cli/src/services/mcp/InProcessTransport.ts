import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

// TODO: SDK/IDE in-process MCP transport is not ported — this build connects to
// external MCP servers only (stdio / streamable-http / sse). The linked
// in-process pair is used solely by the SDK and in-process server branches,
// which are not reachable here; calling it fails loudly.

export function createLinkedTransportPair(): [Transport, Transport] {
  throw new Error('In-process MCP transport is not supported')
}
