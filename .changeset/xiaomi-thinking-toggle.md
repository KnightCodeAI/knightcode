---
"@knightcodeai/cli": patch
---

Fixed Xiaomi MiMo requests that sent `reasoning_effort`. MiMo only accepts a thinking on/off toggle, so the control is off or high and `reasoning_effort` is no longer sent.
