---
"@knightcodeai/cli": patch
---

Changed the branch summary output cap from 2048 to 4096 tokens, clamped to the model's own limit, so summaries of long branches are no longer cut off mid-sentence.
