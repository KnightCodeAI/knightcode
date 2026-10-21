---
"@knightcodeai/cli": patch
---

Fixed the grep tool honouring `RIPGREP_CONFIG_PATH`: a user ripgrep config such as `--fixed-strings` silently turned regex searches literal and returned incomplete results. The tool now runs ripgrep with `--no-config`.
