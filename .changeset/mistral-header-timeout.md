---
"@knightcodeai/cli": patch
---

Fixed Mistral streams being cut off when the response body lasts longer than the request timeout. The timeout now applies only while waiting for response headers.
