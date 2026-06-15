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
  // claude.ai endpoints (only used by the OUT claude.ai connector path).
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
  CLAUDE_AI_ORIGIN: string
}

// The keychain service-name suffix; empty in a standard build. The claude.ai
// fields are inert (the claude.ai connector is not part of a BYOK build).
export function getOauthConfig(): OauthConfig {
  return {
    OAUTH_FILE_SUFFIX: '',
    MCP_PROXY_URL: '',
    MCP_PROXY_PATH: '',
    CLAUDE_AI_ORIGIN: '',
  }
}
