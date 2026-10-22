---
"@knightcodeai/cli": patch
---

Fixed OpenRouter session costs to use the total OpenRouter bills, including upstream inference for bring-your-own-key requests, instead of an estimate from catalog rates. When OpenRouter reports no valid accounting, the catalog estimate is still used.
