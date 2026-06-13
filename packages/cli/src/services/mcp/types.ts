// TODO: the MCP client/transport layer is not implemented yet. The Tool
// surface and context reference these shapes for fields that stay empty until
// then; only the minimal type surface lives here.

export type MCPServerConnection = {
  name: string
  // Connection lifecycle state. Stays empty in practice until the MCP transport
  // lands, but the tool executor branches on it to attach server metadata.
  type?: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  config: {
    type?:
      | 'stdio'
      | 'sse'
      | 'http'
      | 'ws'
      | 'sdk'
      | 'sse-ide'
      | 'ws-ide'
      | 'claudeai-proxy'
    url?: unknown
    [key: string]: unknown
  }
  client?: unknown
  capabilities?: Record<string, unknown>
}

export type ServerResource = {
  server: string
  uri: string
  name?: string
  mimeType?: string
  [key: string]: unknown
}

// The MCP protocol SDK isn't a dependency yet; these mirror the two elicitation
// shapes the tool context's URL-elicitation handler references. Replaced by the
// real SDK types when the MCP transport lands.
export type ElicitRequestURLParams = {
  message: string
  url: string
  [key: string]: unknown
}

export type ElicitResult = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
  [key: string]: unknown
}
