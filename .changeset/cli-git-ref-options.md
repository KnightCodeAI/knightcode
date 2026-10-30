---
"@knightcodeai/cli": patch
---

Fixed git package sources accepting a ref that starts with `-`, which `git fetch` and `git checkout` read as an option rather than a ref. Such sources are now rejected like other malformed git URLs.
