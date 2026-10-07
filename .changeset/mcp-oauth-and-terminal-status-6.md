---
"@knightcodeai/cli": patch
---

Fixed MCP sign-in so closing the session cancels an in-flight login and does not refresh a token on the way out. A login also stops when its time limit is reached, including while discovery is stalled.
