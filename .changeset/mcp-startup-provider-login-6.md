---
"@knightcodeai/cli": patch
---

Fixed codemode scripts calling the wrong MCP tool when two tool names differ only in `-` and `_`, such as `read-file` and `read_file`. MCP tool and namespace names now replace `-` with `_` (`mcp__my-server__x` is now `mcp__my_server__x`), colliding tools of a server all get a hash suffix, and server names that differ only in `-` and `_` are rejected.
