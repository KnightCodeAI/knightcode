---
"@knightcodeai/cli": patch
---

Fixed Gemini 4 models ignoring the selected thinking level. Gemini 4 Argon rejected `thinkingBudget`, so Gemini 4 and later now send `thinkingLevel`.
