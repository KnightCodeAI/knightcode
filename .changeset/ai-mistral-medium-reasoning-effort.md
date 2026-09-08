---
"@knightcodeai/cli": patch
---

Fixed Mistral Medium reasoning requests sending the unsupported `prompt_mode` instead of `reasoning_effort` for reasoning-capable `mistral-medium-*` model IDs such as `mistral-medium-latest`.
