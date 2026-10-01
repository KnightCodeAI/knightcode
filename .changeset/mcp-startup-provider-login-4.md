---
"@knightcodeai/cli": patch
---

Added an `oauth.authServerMetadataUrl` setting for MCP servers that advertise a wrong OAuth authorization server or none. KnightCode uses the configured metadata document instead of discovery.
