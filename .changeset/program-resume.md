---
"@knightcodeai/cli": minor
---

Added session resume for terminals that support the Program Resume Protocol (OSC 7577). KnightCode tells the terminal the command that brings the session back, including `--agent-dir`, `--session-dir` and the restriction and resource flags it was started with, and removes `OSC7577_TOKEN` from every process it starts.
