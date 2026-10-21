---
"@knightcodeai/cli": minor
---

Added worktree threads to the app server: `thread/start` and `thread/fork` can run a thread in a detached git worktree, with per-project environments whose setup and cleanup scripts run for each worktree.
