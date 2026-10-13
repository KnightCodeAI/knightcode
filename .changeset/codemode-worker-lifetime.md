---
"@knightcodeai/cli": patch
---

Fixed stopping a codemode script or reaching its deadline waiting for a non-interruptible built-in to return on Bun; the call now ends promptly.
