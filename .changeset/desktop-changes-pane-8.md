---
"@knightcodeai/cli": patch
---

Added app server methods to configure tools, MCP servers and resources from a client: `tool/list`, `tool/settings/read` and `tool/settings/write` (the `/tools` settings), `mcp/list`, `mcp/update`, `mcp/add` and `mcp/remove`, and `resource/list` and `resource/set` (as `knightcode config`, without the always-on built-in extensions); `config/read` also returns the defaults and the settings files' paths.
