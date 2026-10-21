---
"@knightcodeai/cli": patch
---

Fixed file autocomplete treating regex metacharacters in the query as patterns. Characters such as [ and ( now match literally.
