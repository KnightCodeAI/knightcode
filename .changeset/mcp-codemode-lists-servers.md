---
"@knightcodeai/cli": patch
---

Changed the `codemode` description to list MCP servers instead of their tools, so it no longer changes when a server's tool list changes. Scripts find tools with `searchTools()` and read server instructions with `describeNamespace()`; `codemode-deferred` is now an alias for `codemode`, and `direct` exposure keeps tools visible to the model.
