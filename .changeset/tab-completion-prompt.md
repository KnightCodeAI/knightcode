---
"@knightcodeai/cli": patch
---

Fixed Tab predictions in the desktop IDE repeating the code after the cursor: `knightcode-engine`'s `/v1/completions` now shows the model your code with the cursor marked in place, and strips code fences from the answer.
