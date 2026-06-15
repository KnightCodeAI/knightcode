// Reconstructed from usage: the upstream type file is not in the source dump.
// Shapes inferred from the storage implementations (plainText/keychain/fallback,
// which `satisfies SecureStorage`) and the MCP OAuth persistence in
// services/mcp/auth.ts.

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}

/** One persisted MCP OAuth session, keyed by server identity. */
export interface McpOAuthEntry {
  serverName?: string
  serverUrl?: string
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scope?: string
  clientId?: string
  clientSecret?: string
  stepUpScope?: string
  discoveryState?: {
    authorizationServerUrl?: string
    resourceMetadataUrl?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SecureStorageData {
  mcpOAuth?: Record<string, McpOAuthEntry>
  mcpOAuthClientConfig?: Record<string, { clientSecret?: string }>
  [key: string]: unknown
}
