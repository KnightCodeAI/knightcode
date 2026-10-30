---
"@knightcodeai/cli": patch
---

Changed `tool_search` and code mode's `searchTools()` to weigh a tool's name above its description. A query word in the tool name now outranks any number of mentions in other tools' descriptions, a server's instructions no longer push its tools down, and a query that contains a tool's whole name (`peekaboo app` for `mcp__peekaboo__app`) usually ranks that tool first.
