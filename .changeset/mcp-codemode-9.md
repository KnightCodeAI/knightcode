---
"@knightcodeai/cli": patch
---

Changed bash results returned to scripts so they keep up to 1 MiB of output, with the full output in `full_output_path` when that is still not enough.
