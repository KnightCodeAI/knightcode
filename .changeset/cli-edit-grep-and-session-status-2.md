---
"@knightcodeai/cli": patch
---

Fixed edit diffs so they are computed around each change. Time and memory follow the size of the edit, and a diff that cannot be built leaves the file unchanged.
