---
"@knightcodeai/cli": minor
---

Added native llama.cpp classifiers for decision models such as Julia-1. llama.cpp 0.6.0 reports `decisions` in a model's output modalities, and KnightCode calls those models through the System One endpoint. Chat models still answer from next-token probabilities.
