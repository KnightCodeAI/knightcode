---
"@knightcodeai/cli": patch
---

Fixed a proxied request hanging when the server closed the stream without sending a terminal event, and a final event that arrived without a trailing newline being dropped. The first now surfaces as an error, the second is processed.
