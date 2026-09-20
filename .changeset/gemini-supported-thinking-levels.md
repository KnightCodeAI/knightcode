---
"@knightcodeai/cli": patch
---

Fixed Gemini requests asking for thinking levels a model does not support. Turning thinking off, or picking a level the model lacks, now falls back to the lowest level that model advertises instead of a hard-coded Gemini 3 Pro / Flash guess.
