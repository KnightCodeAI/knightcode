---
"@knightcodeai/cli": patch
---

Fixed `tool_search` and code mode's `searchTools()` finding nothing for queries in languages other than English. Search split text only on ASCII letters and digits, so Chinese, Japanese, Korean, Thai, Cyrillic, Arabic, Hindi or accented words were dropped from both tool descriptions and queries. Text is now split into Unicode words (including scripts written without spaces), and canonically equivalent spellings such as a precomposed and a combining `é` match.
