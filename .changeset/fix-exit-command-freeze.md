---
"@knightcodeai/cli": patch
---

Fix the `/exit` command freezing the terminal in packaged builds. Process cleanup used `spawnSync(process.execPath, ["-e", ...])` as a sleep, but in a compiled standalone binary `process.execPath` is the CLI itself, so it relaunched the TUI and blocked forever. Replaced it with an in-process sleep and made exit terminate the process explicitly.
