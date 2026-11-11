---
"@knightcodeai/cli": patch
---

Fixed updates of installer-managed KnightCode failing their final check on Windows when an older Node.js came first on PATH: the check now runs with the Node.js that runs KnightCode.
