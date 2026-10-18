---
"@knightcodeai/cli": patch
---

Fixed `knightcode` crashing with `zlib.createZstdDecompress is not a function` on Node.js 23.0 through 23.7. It no longer asks servers for zstd-compressed responses that this Node.js cannot decode.
