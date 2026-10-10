<!--
Title: {feat,fix,docs,refactor,chore}(scope): message
scope: ai, agent, cli, tui, server, client, protocol, telemetry, evals, web

Write this yourself. A summary you cannot defend will be closed.
No PR without a maintainer `lgtm` first (CONTRIBUTING.md).
Security bug? Do not open a PR. Follow SECURITY.md.
-->

## What and why

<!--
First line: what is different for a person using KnightCode. A fix says what
broke, a feature says what someone can now do, a chore says who was blocked.
Then the code path underneath. Explain why, not only what.
Performance claims need numbers: before, after, and the command that produced them.
-->

<!--
Approved in: #<issue or discussion where a maintainer said lgtm>
Fixes #<issue this closes; one "Fixes #N" per issue>
-->

## How to check it

<!--
Steps a reviewer can run to see the old behavior and the new one.
For a bug: the exact `knightcode` command, prompt, or keys that reproduce it.
-->

## Testing

<!--
Name the test you added or updated.
A bug fix needs a test that fails without this change.
A behavior change needs a test for the new behavior.
For a GitHub issue, put the issue number in a comment next to that test.
If there is no test, say why.

Then the command and the result: `bun run check-types`, `bun run test`, plus that test.
Example: cd packages/cli && bun x vitest --run test/foo.test.ts
Do not paste pass counts for suites CI runs. Say what you did not check.
-->

- [ ] Tests added or updated, or this change has no behavior to test.

## Changeset

<!--
User-visible? Commit a `.changeset/*.md`.
First word: Added, Changed, Deprecated, Removed, Fixed, or Security.
Otherwise say why this is not user-visible. Do not edit `CHANGELOG.md`.
-->

## Notes

<!-- Delete the lines that do not apply. -->

- Touches `packages/cli/src/core` or a built-in tool description. Why this is not an extension, a skill, or a prompt template:
- Changes a flag, setting, keybinding, provider, or the session format. Docs updated in `packages/cli/docs` (the site copies those):
- Touches paths, spawned shells, or line endings. Checked on Windows:
- Changes something a person sees (TUI, site). Before/after, dark and light theme:
- Adds or bumps a dependency. Why it is needed, and whether it has lifecycle scripts:
- Where a reviewer should start, or what you are unsure about:

## AI use

<!--
None, or the tool and model (e.g. "KnightCode, <model>") and what it did.
AI is fine. You still own every line, and you answer review comments yourself.
Agents: do not claim manual testing that was not done.
-->

- [ ] I searched open PRs and this is not a duplicate.
- [ ] I have read this code and take responsibility for it. Anything I ran is listed under Testing.
