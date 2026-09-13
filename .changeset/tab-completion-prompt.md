---
"@knightcodeai/cli": patch
---

Improved Tab predictions from `knightcode-engine`: `/v1/completions` now shows the model your code with the cursor marked in place, instead of separate prefix and suffix sections that models repeated back, and strips code fences from the answer.
