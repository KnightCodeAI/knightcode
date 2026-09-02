# Development Rules

## The Core Constraint

KnightCode's system prompt and tool definitions sit at a measured floor of
roughly **1,100 tokens**. Every byte added to the core is paid for on every
request, by every user, forever. Before adding to `packages/cli/src/core` or to a
built-in tool description, ask whether it belongs in an extension, a skill, or a
prompt template instead. See `CONTRIBUTING.md`.

## Layout

Bun workspaces: `packages/*` and `apps/*`. Source runs directly under Bun; there
is no build step for development.

| Package | What it is |
| --- | --- |
| `packages/cli` | `@knightcodeai/cli` — the `knightcode` binary: CLI, TUI mode, print mode, RPC mode, sessions, extensions, skills. The only published package with source |
| `packages/cli-{linux,darwin,win32}-*` | Published platform packages; hold a compiled binary in `bin/`, no source |
| `packages/ai` | Multi-provider LLM layer: providers, API adapters, OAuth, model catalog |
| `packages/agent` | Agent loop, harness, compaction, session state, built-in tools |
| `packages/tui` | Terminal UI library with differential rendering |
| `packages/protocol` · `client` · `server` | RPC protocol and transports |
| `packages/session-backend-sqlite` · `telemetry` · `evals` | Session storage, telemetry contracts, eval harness |
| `apps/web` | The website. Separate toolchain; not covered by the root type check |

Everything except `packages/cli*` is private and consumed through the workspace.
The root `tsconfig.json` maps every `@knightcode/*` and `@knightcodeai/cli`
specifier to package source, so imports resolve without a build.

User-facing documentation lives in `packages/cli/docs/`. Keep it in sync when you
change flags, settings, keybindings, providers, or the session format.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- Formatting is Prettier, configured in `.prettierrc`: tabs, 120 columns, LF. `bun run format` formats `.ts`/`.tsx`; check without writing via `bun x prettier --check "**/*.ts"`. Prose is not formatted — Markdown is hand-wrapped, keep it that way.
- `.prettierignore` covers what must not be touched: generated model catalogs, test fixtures (several are deliberately malformed), Changesets-owned changelogs, and `apps/` (own config and toolchain). Don't format those by hand either.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check `node_modules` for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- The root config sets `erasableSyntaxOnly` and covers `packages/*/src` and `packages/*/test`: no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add the binding to `KEYBINDINGS` in `packages/cli/src/core/keybindings.ts` or `TUI_KEYBINDINGS` in `packages/tui/src/keybindings.ts` so it stays configurable.
- Never edit `packages/ai/src/models.generated.ts` or `image-models.generated.ts` directly; change `packages/ai/scripts/generate-models.ts` (or `generate-image-models.ts`) and regenerate with `bun run generate:models`. Including the resulting generated diff is always OK, even when regeneration pulls in unrelated upstream model metadata.
- Code must work on Windows as well as POSIX. Path joins, spawned shells, and line endings are the usual breakages; `.gitattributes` normalizes to LF except for `.bat`/`.cmd`/`.ps1`.

## Commands

Run from the repo root unless stated otherwise.

- After code changes (not docs): `bun run check-types` (full output, no tail). Fix every error before committing. It does not run tests.
- Never run `bun run build:cli` or the full `bun run test` unless the user asks.
- Tests are per-package. Run the specific test you touched from the package root:
  - Vitest packages (`ai`, `agent`, `cli`, `client`, `server`, `protocol`, `session-backend-sqlite`, `evals`): `bun x vitest --run test/specific.test.ts`
  - `packages/tui` (`node:test`): `node --test test/specific.test.ts`
- Whole-package runs work (`cd packages/cli && bun run test`), but on Windows full-suite runs flake on tests that spawn shells. Re-run a failure in isolation before treating it as a regression.
- Some `packages/ai` tests hit real provider endpoints. They self-skip when the credential is absent (`describe.skipIf(!oauthToken)`, `it.skipIf(!process.env.X_API_KEY)`) — but a populated root `.env` activates them, so a full `packages/ai` run spends real tokens and can fail on provider rate limits (HTTP 429) rather than on your change. They are not confined to `*-e2e.test.ts`; `stream.test.ts`, `tokens.test.ts` and others carry live suites too. Check the failure message before treating one as a regression, and never add a live-endpoint test without that guard.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/cli/test/suite/`, use `test/suite/harness.ts` with the faux provider (`packages/ai/src/providers/faux.ts`). No real provider APIs, keys, or paid tokens.
- When adding a regression test for a GitHub issue, put the issue number in a comment next to the test.
- For ad-hoc scripts, write them to a temp file, run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Adding a Provider

`packages/ai/src/providers/` holds one `<name>.ts` per provider, a
`<name>.models.ts` catalog module, and a `data/<name>.json` metadata file.

1. Add the provider module and register it in `providers/all.ts`.
2. Regenerate the catalog with `bun run generate:models` (or `bun run hydrate:model-data` for metadata only). Verify with `bun run check:model-data`.
3. Add tests under `packages/ai/test/` named `<provider>-*.test.ts`. Required at minimum: request construction (headers, base URL, auth), streaming/SSE parsing, and model catalog presence. Follow the closest existing provider's tests.
4. Anything needing a live key goes in a `*-e2e.test.ts` gated on that key's env var.

User-facing notes belong in `packages/cli/docs/providers.md`, or
`custom-provider.md` for endpoint-configured providers.

## Dependency and Install Security

- Treat dependency and `bun.lock` changes as reviewed code. Direct external deps stay pinned to exact versions (`.npmrc` sets `save-exact=true`; `min-release-age=2` blocks freshly published versions).
- When updating `undici`, you MUST read its changelog/release notes for the target version and evaluate whether any changes may affect functionality before applying the update.
- Install with `bun install`; CI-style with `bun install --frozen-lockfile`.
- `bunfig.toml` pins `linker = "hoisted"` on purpose: the isolated layout gives `packages/ai` and `packages/cli` separate copies of a dependency, which breaks `vi.mock()` across package boundaries. Do not change it.
- New deps with lifecycle scripts require review; never add one silently.

## Git

Multiple sessions may be running in this cwd at the same time, each modifying
different files. Git operations that touch unstaged, staged, or untracked files
outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/ai/src/models.generated.ts` may always be included alongside your files.
- Message format: `{feat,fix,docs,refactor,chore}[(<scope>)]: <message>`, scope being the package short name (`ai`, `agent`, `cli`, `tui`, `server`, `client`, `protocol`, `telemetry`, `evals`, `web`). Informative and concise.
- Never add `Co-Authored-By` or other AI-attribution trailers to commit messages.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

See `CONTRIBUTING.md` for the contributor gate (auto-close workflows,
`lgtm`/`lgtmi`, quality bar).

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt.

Triage labels are managed by `.github/workflows/issue-triage-labels.yml`:
`untriaged`, `to-discuss`, `inprogress`, `last-read`, `no-action`. Do not set
them by hand unless the user asks.

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing Interactive Mode

`bun run start` runs the TUI from source with `.env` loaded. For scripted
interaction, drive it in a controlled terminal (POSIX; from the repo root):

```bash
tmux new-session -d -s kc-test -x 80 -y 24
tmux send-keys -t kc-test "bun run start" Enter
sleep 3 && tmux capture-pane -t kc-test -p     # capture after startup
tmux send-keys -t kc-test "your prompt here" Enter
tmux send-keys -t kc-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t kc-test
```

There is no tmux on Windows. Either run `bun run start` and let the user drive
it, or exercise the same paths headlessly with `bun run start --print "..."`.

## Changelog and Releasing

Changelogs are **generated by Changesets**. Never hand-edit
`packages/*/CHANGELOG.md`.

For a user-visible change, add a changeset and commit it with your work:

```bash
bun run changeset [category] [bump]   # defaults: fixed patch
```

That scaffolds `.changeset/<branch>.md` for `@knightcodeai/cli` with the
category word already in place, and you finish the sentence:

> Fixed Windows shell aborts crashing KnightCode when `taskkill.exe` is missing.

**The first word of the summary is the category** — `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed` or `Security` — and it decides which Keep a
Changelog heading the entry lands under. It cannot live in the frontmatter:
`@changesets/parse` reads every frontmatter key as a package name. Do not copy
the imperative style of the entries already in `packages/cli/CHANGELOG.md`
("Add a flag", "Tidy the transcript") — they predate the convention and would
now be rejected.

CI runs `bun run scripts/changelog-sections.ts` (the "Check changesets" step),
which fails on a summary that does not start with a category followed by a
sentence. Run it locally before pushing; it also self-checks the regrouping.

One changeset per change. An entry describing two things has to be filed under
a single heading, so two user-visible changes in one branch means two
changesets — a second `bun run changeset` on the same branch takes the next
free `-2` suffix rather than refusing.

The six `@knightcodeai/cli*` packages are a fixed group in
`.changeset/config.json` — they always version together, so one changeset naming
`@knightcodeai/cli` covers the platform packages too. Reach for `bun x changeset`
only for the rare change that releases some other package. Private
`@knightcode/*` packages are never published and take no changeset.

Releases are automated by `.github/workflows/publish.yml`; there is no local
release command and nothing to publish by hand:

1. A push to `main` with changesets present opens or updates a `chore(release): version packages` PR (`bun run ci:version`, which also regroups the new changelog section under its category headings and drops the commit-hash prefixes).
2. Merging that PR leaves no changesets and a version npm does not have, which triggers the build matrix: each binary is compiled on its own native OS and smoke-tested (`--version`, `--help`) before it goes near npm. `darwin-x64` is cross-compiled and skips the smoke test — there is no free Intel runner.
3. The `publish` job re-runs `check-types` and `test`, reassembles the tested binaries into the platform packages, runs `bun run ci:publish` (pack-test plus `changeset publish` with npm provenance), pushes tags, and creates a GitHub Release with per-platform archives and `SHA256SUMS`.

The `npm-publish` environment holds `NPM_TOKEN` and can gate releases behind
required reviewers. If a publish fails partway, re-run the job — `ci:publish`
skips versions already on npm. Do not bump versions by hand to work around it.

The model catalog is published separately by
`.github/workflows/publish-model-catalog.yml` from `bun run
generate:model-catalog`; dry-run locally with `bun run check:model-catalog`.

## User Override

If the user's instructions conflict with any rule in this document, ask for
explicit confirmation before overriding. Only then execute their instructions.
