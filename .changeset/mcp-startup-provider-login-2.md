---
"@knightcodeai/cli": patch
---

Added `"auth": { "provider": "<provider>" }` for HTTP MCP servers to send a provider's current `/login` token as the bearer token instead of using MCP OAuth. The token is read on every request, so provider refreshes apply. It is only allowed in the global `mcp.json` and from extensions, and requires https except on loopback hosts.
