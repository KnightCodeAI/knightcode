---
"@knightcodeai/cli": patch
---

Fixed a Codex response being dropped when the server closed the stream without a blank line after the final event. The last frame is now processed at EOF instead of being discarded with the buffer.
