---
"@knightcodeai/cli": patch
---

Fixed package installs through a symlinked agent directory, which wrote broken paths because npm was given the link as its prefix.
