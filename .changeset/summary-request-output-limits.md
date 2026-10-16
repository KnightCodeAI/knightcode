---
"@knightcodeai/cli": patch
---

Fixed compaction summaries that failed with "generation hit the token cap" when reasoning used up a fixed output limit. Summary requests no longer set maxTokens, so the provider sizes output from the model's limit and the request that was sent. reserveTokens only decides when automatic compaction starts.