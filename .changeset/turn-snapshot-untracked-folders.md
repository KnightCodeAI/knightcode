---
"@knightcodeai/cli": patch
---

Fixed a turn's changes going unrecorded in a checkout with more than 500 untracked files: a file the agent created there never reached `turn/diff/updated`, so the desktop app's Last Turn was empty and offered no Undo. Past 500, turn snapshots now leave out only untracked folders holding 200 or more files, and fall back to tracked files only when more than 500 remain.
