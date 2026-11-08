---
"@knightcodeai/cli": patch
---

Fixed codemode scripts that edit or write files so each change shows its diff under the script's call row, as a direct edit or write does, and a nested write keeps its `Write(path)` header when its content is long. The app server now includes these file changes too, so the desktop app can show their diffs.
