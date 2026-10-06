---
"@knightcodeai/cli": patch
---

Fixed managed self-update leaving every previous release on disk. After a successful update KnightCode keeps the release that ran the update and the release just activated, and deletes older version directories.
