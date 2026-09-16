---
"@knightcodeai/cli": patch
---

Changed a failed copy to say why: instead of a bare "Copy failed" flash, the message now names the missing clipboard backend — `wl-clipboard`, `xclip`/`xsel` or the Termux API package — and stays on screen for five seconds.
