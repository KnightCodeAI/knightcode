---
"@knightcodeai/cli": patch
---

Fixed Mistral-hosted GLM-5.2 reasoning requests sending `prompt_mode`, which that model ignores, so thinking never turned on; they now send `reasoning_effort`.
