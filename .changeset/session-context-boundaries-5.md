---
"@knightcodeai/cli": patch
---

Fixed `context` extension handlers that filter or slice messages dropping the system prompt and tool declarations, which after extension-driven compaction left requests without built-in tools. Handlers no longer see system messages, and KnightCode restores the prompt and tools after they run.
