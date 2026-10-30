---
"@knightcodeai/cli": patch
---

Changed MCP OAuth sign-in to identify with KnightCode's Client ID Metadata Document by default when the authorization server supports it for public clients, and to register a client dynamically otherwise. A client registered before keeps being used until you sign out. Set `oauth.clientRegistration` to `dcr` to always register, or pass `--oauth-client-registration` to `knightcode mcp add`.
