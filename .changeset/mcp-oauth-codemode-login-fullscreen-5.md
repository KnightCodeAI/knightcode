---
"@knightcodeai/cli": patch
---

Fixed deferred MCP tools that `tool_search` loaded being dropped on resume and `/reload` even when their server reconnected before the next prompt, because the session restored its tools before the MCP servers reconnected.
