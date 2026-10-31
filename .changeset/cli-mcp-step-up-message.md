---
"@knightcodeai/cli": patch
---

Fixed the error for an MCP server that asks for more access than its sign-in granted: it said the server "requires sign-in" although you were signed in. It now names the missing scope and asks you to sign in again to grant it.
