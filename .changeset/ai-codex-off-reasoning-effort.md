---
"@knightcodeai/cli": patch
---

Fixed OpenAI Codex requests omitting the reasoning effort when thinking is off, so models that need an explicit Off level fell back to the provider default; the model's mapped Off effort is now sent, and models that map Off to `null` still send nothing.
