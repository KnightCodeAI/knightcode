---
"@knightcodeai/cli": patch
---

Fixed Fireworks GLM models other than GLM-5.2 being served through the Anthropic-compatible endpoint, which does not accept them. Every `glm-` model on Fireworks now uses the OpenAI completions endpoint, so GLM-5.3 and GLM-5.3 Flash work.
