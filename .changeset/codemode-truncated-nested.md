---
"@knightcodeai/cli": patch
---

Fixed `codemode` results not saying when a nested tool returned truncated text. The result now warns which calls were cut, with their full-output notice.
