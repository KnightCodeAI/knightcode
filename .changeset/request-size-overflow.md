---
"@knightcodeai/cli": patch
---

Fixed request-size errors so HTTP 413 from any provider is treated as overflow. GitHub Copilot's "failed to parse request" response now compacts and retries instead of stopping the turn.
