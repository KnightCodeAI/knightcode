---
"@knightcodeai/cli": patch
---

Fixed `knightcode mcp login -l` and `knightcode mcp logout -l` failing with `Unknown option --local.` although `mcp add` and `mcp remove` accept `-l`. With `-l`, they now require the server to be defined in the project's `.knightcode/mcp.json`. Unknown options are reported as typed, and a mistyped server name gets a suggestion, for example `Did you mean "gurker"?`
