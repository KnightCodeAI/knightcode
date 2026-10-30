---
"@knightcodeai/cli": patch
---

Fixed `knightcode update` claiming an installation is "not managed by a global pnpm install" when it only lives under a package manager's directory, such as a wrapper under `PNPM_HOME`. The message now names the package manager only when it owns the install, and otherwise says to update the package with whatever provides it.
