// TODO: the account-backed (claude.ai) OAuth flow is out of scope for the BYOK
// build. Only the beta header, the MCP dynamic-client-registration metadata
// URL, and the file-suffix the keychain service name reads live here. Per-server
// MCP OAuth (services/mcp/auth.ts) is its own self-contained flow.

export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

// Published client metadata for MCP dynamic client registration (RFC 7591).
export const MCP_CLIENT_METADATA_URL =
  'https://claude.ai/oauth/claude-code-client-metadata'

type OauthConfig = {
  OAUTH_FILE_SUFFIX: string
}

// The keychain service-name suffix; empty in a standard build.
export function getOauthConfig(): OauthConfig {
  return { OAUTH_FILE_SUFFIX: '' }
}
