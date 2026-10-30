---
"@knightcodeai/cli": patch
---

Fixed compaction, branch summaries and bug-report summaries failing for a provider whose API-key path differs from its OAuth login (for example one that refuses explicit keys) while normal prompts worked. Summaries now let the session's model runtime resolve the stored login, as prompts do.
