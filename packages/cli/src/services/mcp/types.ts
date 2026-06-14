// TODO: the MCP client/transport layer is not implemented yet. The Tool
// surface and context reference these shapes for fields that stay empty until
// then; only the minimal type surface lives here.

type MCPServerConfig = {
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

type MCPServerBase = {
  name: string
  config: MCPServerConfig
  capabilities?: Record<string, unknown>
}

// Connection lifecycle is the discriminant; only a connected server carries a
// live client. Stays empty in practice until the MCP transport lands, but the
// tool executor and attachment pipeline branch on `type` and read `client`
// after narrowing to 'connected'.
export type MCPServerConnection =
  | (MCPServerBase & {
      type: 'connected'
      // The connected MCP SDK client. Typed with only the resource-read
      // surface the attachment pipeline touches; replaced by the full SDK
      // Client when the MCP transport lands.
      client: {
        readResource(args: { uri: string }): Promise<ReadResourceResult>
        [key: string]: unknown
      }
    })
  | (MCPServerBase & {
      type: 'failed' | 'needs-auth' | 'pending' | 'disabled'
    })

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

// Minimal stand-in for the MCP SDK's read-resource result; only used as the
// payload type of an mcp_resource attachment, which never fires without a
// connected MCP server. Replaced by the real SDK type when MCP lands.
export type ReadResourceResult = {
  contents: Array<Record<string, unknown>>
  [key: string]: unknown
}

// TODO: per-server MCP configuration (scope, plugin source, transport options)
// lands with the MCP transport. The command-config types reference this shape;
// only the open record is needed until then.
export type ScopedMcpServerConfig = {
  scope?: string
  pluginSource?: string
  [key: string]: unknown
}

// TODO: the canonical MCP ConfigScope is a zod-inferred enum; this literal union
// mirrors it until the MCP config schema ports.
export type ConfigScope = 'local' | 'user' | 'project' | 'dynamic' | 'enterprise' | 'claudeai' | 'managed'
