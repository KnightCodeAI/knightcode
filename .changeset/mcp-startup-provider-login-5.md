---
"@knightcodeai/cli": patch
---

Fixed MCP OAuth sign-in failing with `Invalid scope` when the token response contains `"scope": ""`, and similar failures for other empty or `null` optional OAuth fields, including `expires_in: null` marking the token as already expired.
