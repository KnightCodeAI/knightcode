---
"@knightcodeai/cli": minor
---

Added a classifier gate to `/tools` that asks a classifier model such as Jev whether each shell or file-editing call is risky and asks for confirmation before running it, and exposed `classify()` to extensions through the model registry.
