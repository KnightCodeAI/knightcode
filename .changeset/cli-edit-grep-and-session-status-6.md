---
"@knightcodeai/cli": patch
---

Fixed image reads so the resize worker has finished shutting down before the next image starts one. A second read no longer overlaps a worker that is still terminating.
