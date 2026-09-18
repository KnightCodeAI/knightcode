---
"@knightcodeai/cli": patch
---

Fixed the "Anthropic dropped thinking" notice repeating on every turn and flooding the transcript with per-block reasons. It now shows a short count, only when a response drops more blocks than the previous one, and not again when a session is reloaded; the details stay in the session file.
