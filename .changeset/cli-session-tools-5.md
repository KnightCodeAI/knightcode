---
"@knightcodeai/cli": patch
---

Changed the read tool so a streaming read keeps only the lines it shows, and an extension can supply `ReadOperations.createReadStream` instead of loading the whole file.
