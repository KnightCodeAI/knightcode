---
"@knightcodeai/cli": patch
---

Changed clipboard handling to use small built-in macOS, Windows, and X11 native helpers instead of an external dependency, running native reads on worker threads and making the command-line fallbacks (`pbcopy`, `clip.exe`, `wl-copy`, `xclip`) asynchronous. Incremental X11 transfers, legacy text encodings, and native image formats are preserved.
