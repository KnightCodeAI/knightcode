---
"@knightcodeai/cli": patch
---

Fixed `/tree` summaries ignoring the session's thinking level. Reasoning models that do not accept effort `none` rejected the summary request with a 400 error.
