---
"@knightcodeai/cli": minor
---

Added reopening saved sessions to `knightcode-engine`, so the desktop IDE restores its threads after a restart instead of failing with "Loading or resuming sessions is not supported by this agent".

Its ACP agent now:

- loads a session, replaying its history;
- resumes, lists and deletes saved sessions;
- lists extension commands, prompt templates and skills under `/`;
- after an engine restart, reopens a session it no longer holds and retries the prompt.
