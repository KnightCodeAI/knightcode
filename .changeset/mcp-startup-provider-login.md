---
"@knightcodeai/cli": patch
---

Changed MCP servers without `direct` tools to connect in the background instead of blocking the first prompt. They are listed in a short `mcp_servers` system prompt section, and are waited for when a codemode script names them, a script searches tools, or `tool_search` runs. The `codemode` and `tool_search` descriptions no longer change when servers connect.
