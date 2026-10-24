---
"@knightcodeai/cli": minor
---

Added `file/list` and `file/write` to the app server, and `mtimeMs` to `file/read`: a client can list a folder of the thread's cwd one level at a time for a file tree, and write a file it showed, refused with `fileChanged` when the file has changed since it was read.
