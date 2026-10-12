---
"@knightcodeai/cli": patch
---

Fixed MCP tool calls failing when the server returns structured content that is not an object (an array, `null` or a primitive, as MCP 2026-07-28 allows); codemode declarations of MCP tools without an output schema now type `structuredContent` as `unknown` instead of an object.
