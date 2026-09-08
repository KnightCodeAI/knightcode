---
"@knightcodeai/cli": patch
---

Fixed steering and follow-up messages bypassing extension `input` handlers, so extensions could neither transform nor intercept a message queued while the agent was already streaming; both paths now run the handlers and carry their real input source.
