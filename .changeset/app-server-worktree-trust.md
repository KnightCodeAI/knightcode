---
"@knightcodeai/cli": patch
---

Fixed the app server treating a managed worktree as a project of its own for trust. At a worktree's path, `project/trust/read` and `project/trust/set` now read and record its project's decision, the one its threads load with, and `project/trust/read` names that project in a new `project` field. Project settings, MCP servers and resources read and written there check the same decision; before, trusting there was never seen by a new thread in that worktree, and Settings in the worktree could not read or write project settings once the project was trusted.
