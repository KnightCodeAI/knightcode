---
"@knightcodeai/cli": patch
---

Added an entries argument to `SessionManager.inMemory()`, so an SDK embedder can resume a session held outside the filesystem — in a database, say — without writing it to a temporary `.jsonl` file first.
