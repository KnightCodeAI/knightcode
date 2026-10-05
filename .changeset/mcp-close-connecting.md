---
"@knightcodeai/cli": patch
---

Fixed MCP session shutdown returning while a server was still connecting, leaving its transport open until the server answered or timed out.
