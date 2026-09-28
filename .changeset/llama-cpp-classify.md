---
"@knightcodeai/cli": patch
---

Added a classifier for every connected llama.cpp chat model, so choice, bool, and score questions are answered from next-token label probabilities, with an optional temperature that softens the distribution.
