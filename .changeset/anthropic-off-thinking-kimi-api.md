---
"@knightcodeai/cli": patch
---

Fixed turning thinking off for Claude Haiku 5.5 and Opus 5. Those models accept disabled thinking, but KnightCode kept thinking on the way it does for Opus 5.5. Off now sends disabled thinking and leaves out effort markers, which Anthropic rejects while thinking is disabled.
