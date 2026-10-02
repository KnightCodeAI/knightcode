---
"@knightcodeai/cli": patch
---

Fixed `--provider` without `--model` being silently ignored and running the default model from another provider; it now fails with an error.
