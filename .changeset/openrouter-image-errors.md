---
"@knightcodeai/cli": patch
---

Fixed OpenRouter image requests that failed with HTTP 200 being reported as an empty success. A failing `finish_reason`, a choice error or a reply without choices now returns an error result, and OpenRouter's reported cost is used when it has one.
