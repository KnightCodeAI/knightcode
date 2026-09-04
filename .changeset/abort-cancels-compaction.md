---
"@knightcodeai/cli": patch
---

Fixed aborting a session leaving an in-progress compaction or branch summary running. Escape during `/compact`, or an RPC `abort`, now cancels it and waits for the session to actually be idle before returning.
