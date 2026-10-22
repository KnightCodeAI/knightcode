---
"@knightcodeai/cli": patch
---

Fixed updates of installer-managed installs being stopped by security scanners that block npm's `--min-release-age=0` flag. The managed update runs `npm ci` against a release lockfile that pins every package, so the flag never had an effect and is no longer passed. Global npm, pnpm and bun self-updates keep their age-gate overrides.
