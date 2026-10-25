---
"@knightcodeai/cli": patch
---

Fixed Gemini tool calls whose JSON Schema used const, by sending a single-value enum and leaving literal schema keys intact.
