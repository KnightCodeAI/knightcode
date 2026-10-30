---
"@knightcodeai/cli": patch
---

Fixed images not rendering inline in Orca terminals. Orca supports Kitty graphics and advertises it through `ORCA_IMAGE_PROTOCOL=kitty`, which is now detected.
