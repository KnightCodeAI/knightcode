---
"@knightcodeai/cli": patch
---

Security: MCP OAuth sign-in now rejects an authorization response whose `iss` parameter names another authorization server before exchanging the code (RFC 9207).
