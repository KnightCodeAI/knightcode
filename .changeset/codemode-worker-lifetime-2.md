---
"@knightcodeai/cli": patch
---

Fixed repeated codemode timeouts or aborts accumulating surviving workers; at most two codemode workers now run at once across sessions, counting a cancelled worker until it exits.
