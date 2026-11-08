---
"@knightcodeai/cli": patch
---

Fixed search globs so a folder pattern is relative to the path you searched. `migrations/main/*.js` matches that folder under the path, and `**/migrations/main/*.js` matches it at any depth. A leading `./` is ignored.
