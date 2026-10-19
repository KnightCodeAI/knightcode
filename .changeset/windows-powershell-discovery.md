---
"@knightcodeai/cli": patch
---

Fixed Windows shell discovery so PowerShell is found in its install directory when it is not on PATH, and an empty SystemRoot no longer hides taskkill or bash.
