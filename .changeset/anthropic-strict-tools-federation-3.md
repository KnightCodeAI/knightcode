---
"@knightcodeai/cli": patch
---

Added Anthropic workload identity federation from the Anthropic SDK environment variables `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and `ANTHROPIC_IDENTITY_TOKEN_FILE`, plus the optional `ANTHROPIC_SERVICE_ACCOUNT_ID` and `ANTHROPIC_WORKSPACE_ID`. API keys and `ANTHROPIC_AUTH_TOKEN` take precedence.
