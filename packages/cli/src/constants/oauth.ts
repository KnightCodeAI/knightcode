// The MCP dynamic-client-registration metadata URL and the keychain
// service-name suffix live here. Per-server MCP OAuth (services/mcp/auth.ts)
// is its own self-contained flow.

// Published client metadata for MCP dynamic client registration (RFC 7591).
export const MCP_CLIENT_METADATA_URL =
  'https://knightcode.raghavseth.in/oauth/client-metadata'

type OauthConfig = {
  OAUTH_FILE_SUFFIX: string
  // Hosted-connector endpoints (inert; the hosted connector is not part of a
  // BYOK build).
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
  HOSTED_CONNECTOR_ORIGIN: string
}

// The keychain service-name suffix; empty in a standard build. The
// hosted-connector fields are inert.
export function getOauthConfig(): OauthConfig {
  return {
    OAUTH_FILE_SUFFIX: '',
    MCP_PROXY_URL: '',
    MCP_PROXY_PATH: '',
    HOSTED_CONNECTOR_ORIGIN: '',
  }
}
