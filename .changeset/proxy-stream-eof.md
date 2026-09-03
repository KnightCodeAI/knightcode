---
"@knightcodeai/cli": patch
---

Fixed the proxy transport hanging forever when the server closed the connection mid-response. A stream that ended without a terminal event left the pending result unresolved, so the agent loop waited on it indefinitely; it now reports the dropped connection as an error. A final event that arrived without a trailing newline was also discarded, and is now processed.
