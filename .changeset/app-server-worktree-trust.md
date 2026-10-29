---
"@knightcodeai/cli": patch
---

Fixed the app server's `project/trust/read` and `project/trust/set` treating a managed worktree as a project of its own. At a worktree's path they now read and record its project's decision, the one its threads load with; before, trusting there was never seen by a new thread in that worktree.
