---
"@knightcodeai/cli": patch
---

Fixed llama.cpp decision models that accept images being registered as text-only classifiers. A decision model that reports image input now receives images in the format llama-server reads.
