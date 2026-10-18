---
"@knightcodeai/cli": patch
---

Fixed `knightcode` failing with an unrelated error on a Node.js older than it supports. It now exits with a message naming the required and the installed Node.js versions.
