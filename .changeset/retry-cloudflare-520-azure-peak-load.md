---
"@knightcodeai/cli": patch
---

Fixed two transient provider failures ending the turn instead of retrying: Cloudflare `520` responses and Azure's "currently experiencing high demand" peak-load rejections are now retried like other overload errors.
