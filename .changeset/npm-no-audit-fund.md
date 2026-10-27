---
"@knightcodeai/cli": patch
---

Fixed `install`, `remove` and `update --extensions` printing npm's audit and funding advice. Following that advice (`npm audit fix`) installed a second copy of the CLI's own packages into the extension directory.
