---
"@knightcodeai/cli": patch
---

Read EXIF orientation from JPEGs whose first APP1 segment holds XMP instead of
EXIF. Such images previously rendered unrotated.
