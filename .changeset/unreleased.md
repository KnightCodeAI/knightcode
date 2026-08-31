---
"@knightcodeai/cli": patch
---

Tool calls now render as blocks in the transcript. Each one shows a
`Bash(...)` / `Read(...)` / `Update(...)` header with its result collapsed
underneath on a `⎿` gutter, instead of the flat before/after dump. The rest of
the chrome — boxed messages, the rounded input frame, the braille spinner, the
banner and footer — is unchanged.

Fixed a context-window overflow loop. Messages with no provider usage yet are
estimated at 4 chars/token, but real tokenizers land nearer 3 on code and JSON,
so reserving `max_tokens` against the raw estimate could push prompt +
`max_tokens` past the window. The provider rejected it as an overflow, the agent
compacted, `max_tokens` re-expanded into the freed room, and the next request
failed the same way. The estimated part is now padded so the reservation stays
inside the window.
