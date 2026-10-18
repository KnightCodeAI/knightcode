---
"@knightcodeai/cli": minor
---

Changed the npm package and the installer to ship KnightCode as JavaScript that runs on your own Node.js instead of a per-platform binary with Bun embedded, cutting the download from about 125 MB to about 3 MB; KnightCode now requires Node.js 22.19 or newer, and the standalone binaries remain available from GitHub releases for machines without Node. An npm install updating from an earlier version can report a failed update after installing this one; restart KnightCode to use it.
