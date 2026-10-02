---
"@knightcodeai/cli": patch
---

Fixed slash command completion not working after leading whitespace in the editor. Typing `  /mod` now completes to `  /model ` and keeps the whitespace.
