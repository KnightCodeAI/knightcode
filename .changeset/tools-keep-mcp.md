---
"@knightcodeai/cli": patch
---

Fixed `--tools` removing MCP tools, which left `knightcode --tools codemode` without any MCP servers. `--tools` now keeps MCP tools unless an entry starts with `mcp__`.
