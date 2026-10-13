---
"@knightcodeai/cli": minor
---

Added `reachesTools` to tool definitions, so tools that reach other tools (such as `codemode` and `tool_search`) declare which tools a call may reach; the MCP extension uses it to wait for the servers a call needs and to decide whether a replacement `codemode` or `tool_search` tool can reach MCP tools.
