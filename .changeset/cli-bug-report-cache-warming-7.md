---
"@knightcodeai/cli": patch
---

Fixed clipboard copying in headless and remote sessions by restoring the OSC 52 fallback when no native clipboard is reachable, including under WSL.
