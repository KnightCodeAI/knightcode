---
"@knightcodeai/cli": patch
---

Fixed resized photos being sent as multi-megabyte PNGs, which could make requests fail or time out. Resizing now picks whichever of PNG and JPEG is smaller at each size step; screenshots where PNG is smaller still go out as PNG.
