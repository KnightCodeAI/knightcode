---
"@knightcodeai/cli": patch
---

Fixed Bedrock requests that fail with `The pending stream has been canceled` after a stalled HTTP/2 connection not being retried automatically.
