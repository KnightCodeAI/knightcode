---
"@knightcodeai/cli": patch
---

Fixed `knightcode update` reporting an npm package as updated when npm actually installed the old version again (stale registry metadata shortly after a publish). It now warns that the package is still on the old version and suggests trying again in a few minutes.
