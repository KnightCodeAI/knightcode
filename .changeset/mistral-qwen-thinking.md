---
"@knightcodeai/cli": patch
---

Fixed Mistral reasoning requests using a hardcoded model list. A model with a thinking-level map now sends `reasoning_effort` for the requested level, including max on GLM 5.2, and sends the model's off value when thinking is off. GLM 5.3 no longer uses `prompt_mode`.
