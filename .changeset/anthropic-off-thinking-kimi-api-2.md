---
"@knightcodeai/cli": patch
---

Fixed Kimi Coding requests failing with HTTP 404. The provider uses Anthropic Messages at https://api.kimi.com/coding again, so the client no longer appends /v1/messages to a base URL that already ends in /v1.
