---
"@knightcodeai/cli": patch
---

Removed the `shouldStopAfterTurn` agent option. Return `{ action: "end" }` from `finishTurn` instead, and return nothing for error and aborted responses to keep the old normal-response-only behaviour.
