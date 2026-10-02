---
"@knightcodeai/cli": patch
---

Changed MCP OAuth credential storage to key credentials by server name and URL, so MCP servers with the same URL can sign in with different accounts. Credentials stored by URL alone move to the first server that uses them.
