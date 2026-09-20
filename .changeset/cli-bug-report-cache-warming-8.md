---
"@knightcodeai/cli": patch
---

Fixed the terminal waiting on a remote prompt event that was never awaited, which could drop a prompt sent from the phone.
