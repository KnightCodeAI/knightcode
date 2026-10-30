// Client ID Metadata Documents for MCP OAuth sign-in. The CLI identifies as
// these URLs (CLIENT_METADATA_BASE_URL in packages/cli/src/extensions/mcp/oauth.ts),
// and the authorization server fetches them to learn the redirect URIs.
const BASE_URL = "https://knightcode.dev/oauth"

// The CLI's callback ID: 9 bytes of a SHA-256, base64url.
const CALLBACK_ID = /^[A-Za-z0-9_-]{12}$/

export function isCallbackId(id: string) {
  return CALLBACK_ID.test(id)
}

// Without an ID, the document every authorization server that sends `iss`
// shares; with one, the document specific to a single MCP server.
export function clientMetadataResponse(id?: string) {
  const path = id ? `/callback/${id}` : "/callback"
  return Response.json(
    {
      client_id: id
        ? `${BASE_URL}/${id}/client.json`
        : `${BASE_URL}/client.json`,
      client_name: "knightcode",
      client_uri: "https://knightcode.dev",
      logo_uri: "https://knightcode.dev/knightcode-mark.svg",
      application_type: "native",
      redirect_uris: [`http://127.0.0.1${path}`, `http://localhost${path}`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      token_endpoint_auth_methods_supported: ["none"],
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    }
  )
}
