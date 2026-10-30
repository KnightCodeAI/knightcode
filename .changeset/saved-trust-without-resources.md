---
"@knightcodeai/cli": patch
---

Fixed a saved "Do not trust" decision being ignored for projects without trust-requiring resources, such as a folder with only `AGENTS.md`. Such projects were always auto-trusted, so `ctx.isProjectTrusted()` returned true and package commands treated them as trusted. A saved decision in `trust.json` now wins; auto-trust applies only when nothing is saved.
