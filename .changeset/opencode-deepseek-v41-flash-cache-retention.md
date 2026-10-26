---
"@knightcodeai/cli": patch
---

Fixed OpenCode DeepSeek V4.1 Flash requests sending `prompt_cache_retention`. The model is the renamed DeepSeek V4 Flash and, like it, does not accept the long cache retention parameter.
