---
"@knightcodeai/cli": patch
---

Fixed llama.cpp context windows so a reload keeps the last known size when the server has not reported one, and a configured `--ctx-size` is used before the training context.
