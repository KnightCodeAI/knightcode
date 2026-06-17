---
"@knightcodeai/cli": patch
---

### Added

Accurate per-session cost: enable OpenRouter usage accounting (`usage.include`) so each request returns its **actual** cost. The in-app `/cost` "Session cost" now sums real costs (correct for free/cached/uncurated models) and only falls back to the local price table when a message has no reported cost.

Session grouping on OpenRouter: send the session id as the `x-session-id` header so a session's requests are grouped in OpenRouter's logs (Sessions tab) and routed stickily to the same provider for better prompt-cache hits. Requests are also tagged with the session id via the `user` field for per-request "Client User ID" attribution.

### Changed

OpenRouter app attribution: `HTTP-Referer` → `https://knightcode.raghavseth.in` and `X-Title` → `KnightCode` (was "KnightCode CLI").
