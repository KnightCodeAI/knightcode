---
"@knightcodeai/cli": patch
---

Fixed `knightcode-engine` answering a login request whose body is not JSON, or is too large, with a 500 instead of a 400 or 413.
