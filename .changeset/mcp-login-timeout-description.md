---
"@knightcodeai/cli": patch
---

Fixed `knightcode mcp login --timeout` being described as a wait for the browser; it limits the whole sign-in, including requests to the authorization server.
