---
"@knightcodeai/cli": patch
---

Fixed the standalone binary loading `.env` and `bunfig.toml` from the working directory before startup. Project secrets no longer enter the process environment, and a project preload can no longer crash the binary.
