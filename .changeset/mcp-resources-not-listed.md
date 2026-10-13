---
"@knightcodeai/cli": patch
---

Fixed MCP servers with resources keeping their tools out of the first prompt while a slow resource listing finished (a large drive, for example). Connecting no longer lists resources; `/mcp` and `knightcode mcp list` now show that a server offers resources, and the resource tools still list and read them on demand.
