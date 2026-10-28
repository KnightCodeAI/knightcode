---
"@knightcodeai/cli": patch
---

Added Claude Code and Grok Build plugin support: `knightcode plugin` and `/plugins` install plugins and marketplace catalogs from GitHub, Git URLs and local folders, and a trusted plugin's skills, `/<plugin>:<command>` commands and MCP servers load in new and reloaded sessions. Plugins run nothing until trusted; hooks, agents, LSP servers and output styles are listed but never run. See docs/plugins.md.
