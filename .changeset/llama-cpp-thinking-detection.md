---
"@knightcodeai/cli": patch
---

Fixed llama.cpp models whose chat template supports thinking (Qwen-style `enable_thinking`) always running as non-reasoning models. Loaded models are now checked through the server's `/props`, and those templates get an on/off thinking toggle.
