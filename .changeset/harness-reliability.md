---
"@knightcodeai/cli": minor
---

Harness reliability: read-before-write safety and transient-failure recovery

- Session-scoped file-state ledger: edits now require the file to have been read first and reject when it changed on disk since that read (read-before-write + staleness guard), seeded from the transcript so it survives a resume.
- Edit tools collapse identical safe reads within a round and stop looping on repeated identical calls sooner (loop-guard threshold lowered).
- Streaming recovery: transient stream failures and empty responses are retried with bounded exponential backoff (honoring Retry-After); a cancel during backoff no longer triggers an extra model call.
- An invalid tool call no longer ends the turn — the model is given the error and a chance to self-correct.
- A file edit diff is shown only once the edit actually applies; failed or rejected edits no longer render a misleading diff.
