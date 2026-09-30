---
"@knightcodeai/cli": patch
---

Fixed context overflow errors from the Z.AI China endpoint ("Prompt exceeds max length") not being recognised, so compaction and retry now trigger for them as they do for the global endpoint.
