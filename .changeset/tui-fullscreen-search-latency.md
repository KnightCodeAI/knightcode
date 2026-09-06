---
"@knightcodeai/cli": patch
---

Reduced fullscreen transcript search latency on large transcripts by caching unchanged search results, indexing ASCII runs, and limiting highlight work to visible matches.
