---
"@knightcodeai/cli": patch
---

Fixed agent-level retry backoff doubling without a ceiling, which left the agent asleep for hours after a long provider outage. Assistant and summarization retries now cap each delay at the new `retry.maxAgentDelayMs` setting, defaulting to 60 seconds.
