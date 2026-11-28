---
"@knightcodeai/cli": patch
---

Fixed Kitty images in regular mode: image IDs stay within the signed 32-bit range some terminals require, and a new image is appended without redrawing the whole screen.
