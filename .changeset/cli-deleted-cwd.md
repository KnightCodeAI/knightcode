---
"@knightcodeai/cli": patch
---

Fixed starting `knightcode` from a directory that has since been deleted: it crashed with an `ENOENT ... uv_cwd` stack trace (also for `--version` and `--help`). It now prints that the working directory no longer exists and exits with code 1.
