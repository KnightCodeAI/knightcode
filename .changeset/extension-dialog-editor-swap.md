---
"@knightcodeai/cli": patch
---

Fixed an open extension dialog disappearing when an extension replaced the editor component. The dialog stayed pending with nothing on screen to answer it; the new editor now waits until the last dialog closes.
