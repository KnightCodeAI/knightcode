---
"@knightcodeai/cli": minor
---

Added `--agent-dir <dir>` to use another config directory for one run. It takes precedence over `KNIGHTCODE_CODING_AGENT_DIR`, works with subcommands, is passed to processes KnightCode starts, and appears in the resume command printed on exit.
