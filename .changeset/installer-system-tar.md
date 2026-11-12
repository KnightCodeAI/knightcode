---
"@knightcodeai/cli": patch
---

Fixed the Windows installer taking over 20 seconds to unpack Node.js: it now uses the tar that ships with Windows when available.
