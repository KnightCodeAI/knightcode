---
"@knightcodeai/cli": patch
---

Fixed a Codex thinking-level change invalidating the prompt cache, and forwarded max output tokens that the Codex request was dropping. Thinking-level changes on GPT-6 Codex models go out as configuration updates with a fixed effort, including switching to off.
