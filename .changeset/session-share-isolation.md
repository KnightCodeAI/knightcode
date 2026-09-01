---
"@knightcodeai/cli": patch
---

Give each `/share` its own temp directory so two shares running at once no
longer overwrite each other's export or delete the other's file mid-upload.
