---
"@knightcodeai/cli": patch
---

Fixed `tool_search` and codemode's `searchTools()` ranking another tool above the one the query names. A query equal to a tool's full name, or to the part after a `__` separator (`thread_read` for `mcp__app__thread_read`), now puts that tool first, in any case and with `-` or a space in place of `_`.
