---
"@knightcodeai/cli": patch
---

Fixed npm and pnpm self-updates installing a release that the running Node.js cannot start. The update now fails and the installed version keeps working.
