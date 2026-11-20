---
"@knightcodeai/cli": patch
---

Added a transcript notice when OpenAI drops replayed reasoning items, naming the reason, the same way a dropped Anthropic thinking block is shown. Removals that only mark an earlier turn's reasoning are left out.
