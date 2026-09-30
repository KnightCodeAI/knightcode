---
"@knightcodeai/cli": patch
---

Added an `oauth.clientName` setting for MCP servers (`knightcode mcp add --oauth-client-name`) to change the client name sent during OAuth client registration, for servers such as Figma that only accept known clients.
