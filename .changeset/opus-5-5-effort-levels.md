---
"@knightcodeai/cli": patch
---

Fixed Claude Opus 5.5 offering a `minimal` thinking level the model does not support. Anthropic publishes low through max for it, so `minimal` no longer appears in `/thinking` or model cycling.
