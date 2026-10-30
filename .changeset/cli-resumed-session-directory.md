---
"@knightcodeai/cli": patch
---

Changed the `--continue`, `--resume`, `--session`, `--session-id` and `--fork` help and the `/resume` and `/import` descriptions to say which working directory a session runs in. A resumed or imported session keeps the directory it was created in, which can differ from the current one; `--continue`, `--fork` and `--session-id` use the current directory.
