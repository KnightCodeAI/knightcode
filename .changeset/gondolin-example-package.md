---
"@knightcodeai/cli": patch
---

Fixed the Gondolin example extension depending on a package name that does not exist on npm, so `npm install` in its directory failed. It now depends on the published Gondolin package, version 0.14.0, which drops node-forge and moves to a patched undici, clearing the advisories both had. The containerization docs link the Gondolin project and state its new Node.js 22.19 minimum.
