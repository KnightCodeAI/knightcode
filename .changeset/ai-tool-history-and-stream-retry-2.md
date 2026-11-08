---
"@knightcodeai/cli": patch
---

Added `requiresToolsWithToolHistory` for Chat Completions models. When it is on, a request whose history contains tool calls sends `"tools": []` instead of leaving `tools` out. The default stays off, so the field is still omitted.
