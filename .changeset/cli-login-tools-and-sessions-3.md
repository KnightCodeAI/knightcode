---
"@knightcodeai/cli": patch
---

Fixed the PowerShell tool on Windows PowerShell 5.1. A native command that exits 0 and only writes a warning to stderr is reported as success.
