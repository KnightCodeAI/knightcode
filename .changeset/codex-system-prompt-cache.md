---
"@knightcodeai/cli": patch
---

Fixed Codex prompt caching of the system prompt on GPT-6.2. The service appends a top-level instructions field after the input, so the system prompt changed on every turn and was never served from the cache. It is now the first developer input item.
