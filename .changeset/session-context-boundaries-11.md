---
"@knightcodeai/cli": patch
---

Fixed `/bug` uploading a report in offline mode. Uploads are refused with a pointer to Export as Zip, which still works offline.
