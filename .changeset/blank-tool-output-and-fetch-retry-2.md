---
"@knightcodeai/cli": patch
---

Fixed retries for node-fetch errors worded "request to <url> failed, reason:", including a Google token refresh that reports an empty reason. Those failures now retry like other fetch transport errors.