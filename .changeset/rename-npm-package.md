---
"knightcode": minor
---

Changed the npm package name from `@knightcodeai/cli` to `knightcode`, so it installs with `npm install -g knightcode`. `knightcode update` moves an existing `@knightcodeai/cli` install to the new package, and extensions that import `@knightcodeai/cli` keep loading.
