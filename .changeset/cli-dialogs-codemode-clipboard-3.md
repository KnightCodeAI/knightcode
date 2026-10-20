---
"@knightcodeai/cli": patch
---

Fixed codemode scripts failing as soon as both workers were busy. A script waits in arrival order for a free worker, the wait counts toward `timeout_ms` and abort, and the wait stops after 60 seconds. `KNIGHTCODE_CODEMODE_MAX_WORKERS` raises the process-wide limit of two.
