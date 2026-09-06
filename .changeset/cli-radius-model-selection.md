---
"@knightcodeai/cli": patch
---

Fixed post-login model selection for Radius, whose per-account catalog is empty until the first authenticated refresh; selection now waits for that refresh, defaults to `balanced`, and falls back to catalog order.
