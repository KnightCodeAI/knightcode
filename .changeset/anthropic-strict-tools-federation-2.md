---
"@knightcodeai/cli": patch
---

Fixed provider retries aborting or firing immediately when a `Retry-After` or `retry-after-ms` value is too large to represent, such as `1e999`. They now use exponential backoff, as they do for an unparseable date.
