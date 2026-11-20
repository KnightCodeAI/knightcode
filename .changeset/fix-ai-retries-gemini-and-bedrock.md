---
"@knightcodeai/cli": patch
---

Fixed cancelled request retries so the backoff wait removes its abort listener.
