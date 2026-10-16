---
"@knightcodeai/cli": patch
---

Fixed tool results that contain only whitespace being sent as text. OpenAI and Google requests now treat that text as empty and use the same placeholder as a result with no text.