---
"@knightcodeai/cli": patch
---

Fixed closing an extension overlay removing a different overlay. When another overlay had opened above it, closing the lower one hid the topmost overlay instead and left the closed one on screen.
