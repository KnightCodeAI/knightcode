---
"@knightcodeai/cli": patch
---

Fixed a nested git worktree whose AGENTS.md is a symlink to the main repo's copy so that file is loaded once. The walk compared the file's real path, which made the symlink look like the main repo's file and dropped both.
