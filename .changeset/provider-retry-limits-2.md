---
"@knightcodeai/cli": patch
---

Fixed mid-stream disconnects reported as "stream disconnected before completion" being treated as final. Those disconnects are retried.
