---
"@knightcodeai/cli": patch
---

Fixed a LiteLLM proxy rejecting an oversized request with `ContextWindowExceededError` ("Context Window exceeded for given call") ending the turn as an ordinary error; it is now recognised as a context overflow, so the session compacts and retries.
