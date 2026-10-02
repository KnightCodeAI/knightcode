---
"@knightcodeai/cli": patch
---

Added Radius to `/login`: "Sign in with Radius" is the last top-level option, with its status, and after signing in `/login` offers to add the Radius MCP server to the global `mcp.json` with `"auth": { "provider": "radius" }`. Cancelling a login returns to the menu it was started from, only subscription-backed providers are labeled "subscription" (other OAuth sign-ins say "account"), and providers without credentials say "not configured".
