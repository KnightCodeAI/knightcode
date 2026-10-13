---
"@knightcodeai/cli": patch
---

Fixed an MCP tool call that was cancelled or timed out while waiting for a shared OAuth refresh still being sent to the server once the refresh finished.
