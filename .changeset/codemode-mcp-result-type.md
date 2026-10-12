---
"@knightcodeai/cli": patch
---

Changed codemode declarations of MCP tools to spell out the result type (`content`, `structuredContent`, `isError`) instead of referring to `CallToolResult<T>`, which `describeTool()`, `searchTools()` and `ALL_TOOLS` showed without defining it; the codemode description no longer includes the shared MCP types.
