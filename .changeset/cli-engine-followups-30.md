---
"@knightcodeai/cli": patch
---

Fixed MCP stream reading so a CR-only event stream is recognized and a large stdio message is read in linear time.
