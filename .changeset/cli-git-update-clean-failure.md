---
"@knightcodeai/cli": patch
---

Fixed `knightcode update` stopping with `git clean -fdx failed with code 1` on Windows when another KnightCode session had a git extension's native module or executable open. Windows cannot delete such files, so the update left the new code with the old dependencies. KnightCode now warns, installs the dependencies anyway, and retries the clean on the next update.
