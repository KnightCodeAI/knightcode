---
"@knightcodeai/cli": patch
---

Fixed provider calls that fail with only a socket error code, such as `read ECONNRESET` or `connect ETIMEDOUT`, so those calls are retried.
