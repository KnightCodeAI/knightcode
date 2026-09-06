---
"@knightcodeai/cli": patch
---

Fixed `fd` failing to start on musl-based Linux distributions by downloading the statically linked musl builds of both `fd` and `ripgrep`.
