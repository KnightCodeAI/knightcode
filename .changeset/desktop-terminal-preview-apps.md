---
"@knightcodeai/cli": minor
---

Added MCP Apps: a tool that declares an app (`_meta.ui.resourceUri`) shows it in the desktop app, which reads and calls its server through the new `mcp/app/readResource` and `mcp/app/callTool` app server methods, asking first before a call that may change things.
