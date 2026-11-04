---
"@knightcodeai/cli": patch
---

Added Anthropic message threads, so a session on api.anthropic.com sends only the new messages and continues from the previous reply, with a full request when earlier history changed.
