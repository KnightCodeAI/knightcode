---
"@knightcodeai/cli": patch
---

Fixed MCP servers that ask for more scope (`insufficient_scope`) requesting sign-in over and over. The new sign-in requested only the missing scopes, so the new token lost access the previous one had; it now keeps the granted scopes.
