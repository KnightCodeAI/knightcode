---
"@knightcodeai/cli": patch
---

Fixed finished tool calls whose arguments were not valid JSON. The tool no longer runs with only the fields parsed before the error. The model is told the arguments were malformed.
