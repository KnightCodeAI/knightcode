---
"@knightcodeai/cli": minor
---

Add automatic skill discovery, hot-reload, and path-scoped skills so installed skills surface and get loaded without having to be named explicitly.

### Added

- **Skill auto-discovery.** Each turn a cheap side-query compares your request against the installed skills, surfaces the relevant ones, and directs the model to load them via the `Skill` tool before responding. Surfaced skills appear as a visible `↳ Relevant skills: …` line in the chat. Controlled by the `skills.autoDiscover` setting (on by default).
- **Skill hot-reload.** A file watcher picks up added, edited, or removed `SKILL.md` files mid-session, so changes take effect without restarting. Controlled by the `skills.hotReload` setting (on by default).
- **Path-scoped (conditional) skills.** A skill with a `paths` frontmatter glob is kept out of the always-on skill list and surfaces only when you edit a file matching its globs.

### Changed

- The skill index injected into the system prompt is now size-bounded: descriptions are truncated to fit the budget and, in the extreme, the listing falls back to names only — but every skill name is always shown, so no installed skill becomes undiscoverable.
