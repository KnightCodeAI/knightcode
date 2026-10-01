---
"@knightcodeai/cli": patch
---

Fixed provider retries firing immediately when a `Retry-After` header contains an unparseable date. They now use exponential backoff.
