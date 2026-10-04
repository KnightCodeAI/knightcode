---
"@knightcodeai/cli": patch
---

Fixed cancelling a request or model refresh during an OAuth token refresh discarding the rotated credential. Providers that rotate refresh tokens, such as Sign in with ChatGPT, then rejected the next request with `refresh_token_invalidated`. Cancelling now only stops the wait for the credential lock; a refresh that has started completes and is saved.
