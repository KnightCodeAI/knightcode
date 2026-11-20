---
"@knightcodeai/cli": patch
---

Fixed request retries for Cloudflare error 525, a gateway that says the provider is temporarily unavailable, a response that ends before it is complete, and other temporary provider failures.
