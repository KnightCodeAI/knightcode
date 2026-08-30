# Development Rules

## Project

KnightCode — a local, BYOK terminal coding agent. `@knightcodeai/cli` on npm,
`knightcode` on the command line.

Derived from [pi](https://github.com/earendil-works/pi) (MIT, Mario Zechner),
rebranded and re-scoped to `@knightcode/*`. That attribution in `LICENSE`,
`README.md`, and this file is a license condition — never remove it.

- **Runtime**: Bun. Source runs directly; no build step for development.
- **Language**: TypeScript, ESM, `.ts` extensions in relative imports.
- **Packages**: bun workspaces (`packages/*`). No npm, no `package-lock.json` —
  the lockfile is `bun.lock`.
- **Terminal UI**: `@knightcode/tui` — imperative components with
  `render(width): string[]`. **Not React.**

Layout: `packages/cli` is the binary and the bulk of the product;
`packages/ai` is the multi-provider layer; `packages/agent` is the loop and
harness; `tui`, `client`, `server`, `protocol`, `telemetry`,
`session-backend-sqlite` support them; `packages/cli-<platform>` are the
compiled-binary distribution stubs (their `bin/` is built by CI, never
committed).

Typechecking is a single root `tsc --noEmit` — the root `tsconfig.json` maps
every `@knightcode/*` specifier to package source, so there is no per-package
build to run first.

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
- Maintain existing style conventions (tabs, biome-style formatting).
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/cli/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it. This is a fork with no external installed base; pi-era compatibility shims are dead weight, not obligations.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `KEYBINDINGS` (`packages/cli/src/core/keybindings.ts`) or `TUI_KEYBINDINGS` (`packages/tui/src/keybindings.ts`) so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` or `packages/ai/src/providers/data/*.json` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting diff is always OK, even if regeneration sweeps in unrelated upstream model metadata changes.

## Names that are third-party, not branding — do not rebrand

The pi→KnightCode rebrand is complete. Exactly two `pi` strings remain in
source, both identifiers owned by a third party, each carrying an inline
comment saying so. Do not "fix" them:

- `DEFAULT_RADIUS_GATEWAY = "https://radius.pi.dev"` (`ai/src/providers/radius-config.ts`) — Radius's own hostname.
- `OAUTH_CLIENT_ID = "pi-gateway"` (`ai/src/auth/oauth/radius.ts`) — the OAuth client id Radius issues.

Also legitimate and not to be swept: `@mariozechner/clipboard` (a real
published dependency), `cchistory.mariozechner.at` (a source citation in
`ai/src/api/anthropic-messages.ts`), `\pi`/`\Pi` in `tui/src/latex.ts`, and the
math builtins inside the vendored `cli/src/core/export-html/vendor/highlight.min.js`.

`originator` (OpenAI Codex) and `referrer` (xAI OAuth) now send `"knightcode"`.
These are client identifiers the providers recognise — **if ChatGPT-subscription
or xAI OAuth sign-in starts failing, look here first.**

## Commands

Run from the repo root unless noted.

- **After code changes (not docs): `bun run check-types`** (full output, no tail).
  Fix every error before committing. Does not run tests.
- `bun run dev` — watch mode. `bun run start` — run once.
- `bun run format` — prettier over `**/*.{ts,tsx,md}`.
- Never run `bun run build:cli` or the full test suite unless the user asks.
- Tests are vitest in every package except `packages/tui`, which uses `node --test`.
  - Whole package: `cd packages/<pkg> && bun run test`
  - One vitest file: `cd packages/<pkg> && npx vitest --run test/specific.test.ts`
  - One tui file: `cd packages/tui && node --test test/specific.test.ts`
  - **Do not** pass `--root packages/<pkg>` from the repo root — tests that read
    `process.cwd()` (e.g. `cli/test/resource-loader.test.ts`) break on the wrong cwd.
- `bun run test` (every package in parallel) is **not reliably green on
  Windows**, and was not before any recent change — a pristine checkout fails
  too. Each run fails a different 2–5 tests and every one of them spawns a child
  process (`agent/test/harness/nodejs-env`, `cli/test/bash-close-hang-windows`,
  `git-update`, `resolve-config-value`, `startup-session-name`, `auth-storage`,
  `generate-models-strict`), on 3 s timeouts and `EPERM` temp-dir cleanups.
  **Before believing a full-suite failure, re-run that file alone or the whole
  package alone.** Only then is it a real regression.
- If you create or modify a test file, run it and iterate until it passes.
- For `packages/cli/test/suite/`, use `test/suite/harness.ts` + the faux
  provider (`ai/src/providers/faux.ts`). No real provider APIs, keys, or paid tokens.
- Regression tests for a GitHub issue: name the file with the issue number
  (see `cli/test/suite/regressions/`) and comment the issue number in the test.
- For ad-hoc scripts, write to a temp file, run, edit if needed, remove when
  done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Model catalog

Two separate things share one generator (`packages/ai/scripts/generate-models.ts`,
network only, no API keys):

**Built-in catalog** — `packages/ai/src/providers/data/*.json` plus the
`src/models.generated.ts` aggregator, compiled into the binary.

```bash
bun run hydrate:model-data     # refresh the data JSONs only
bun run generate:models        # data + models.generated.ts + image models
bun run check:model-data       # validate without regenerating
```

Regenerating fails with `EPERM` while `bun run dev`/`--watch` is running: bun's
watcher holds a handle on `src/providers/data`, which the script renames. Stop
watchers first. It cuts both ways — it picks up real pricing fixes but also
churning marketing names, so assert router-wide properties in tests rather than
a specific tier string.

**Published catalog** — the same data as a bundle uploaded to R2, so shipped
clients pick up new models without a release.
`packages/cli/src/core/remote-catalog-provider.ts` overlays it on the built-in
catalog every 4 hours.

```bash
bun run generate:model-catalog   # → .artifacts/model-catalog/
bun run check:model-catalog      # validate the bundle, upload nothing
```

`.github/workflows/publish-model-catalog.yml` runs both on a schedule, then
`scripts/publish-model-catalog.mjs` uploads. Revisions are content-addressed
(`models/v1/revisions/sha256-<digest>/`) and immutable; `models/v1/index.json`
is the only mutable object, written last, so a bad catalog is rolled back by
repointing it rather than by overwriting anything. Publishing is gated on
required providers being present and a >=500 model floor.

**Not yet wired up** — the workflow needs an R2 bucket (`knightcode-artifacts`),
the `KNIGHTCODE_ARTIFACTS_R2_*` secrets, an `R2_ENDPOINT` variable, and a
`knightcode-model-upload` environment. Separately, the client fetches
`https://knightcode.raghavseth.in/api/models/providers/<id>`, and **nothing in
this repo serves that path** — pi's equivalent lives in its closed-source site,
so it has to be written (a Worker over the R2 bucket is the natural fit).

## Dependency and Install Security

- Treat dependency and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- When updating `undici`, you MUST read its changelog/release notes for the target version and evaluate whether any changes may affect functionality before applying the update.
- Install with `bun install`. `bunfig.toml` sets `linker = "hoisted"` on
  purpose — the vendored suite assumes ONE physical copy of each dependency, and
  bun's default isolated layout gives `packages/ai` and `packages/cli` separate
  copies of `openai`, which breaks `vi.mock("openai")`. **Do not remove it.**
- If a `packages/*/node_modules` from an older layout is shadowing the hoisted copies, delete it.

## Git

Multiple KnightCode sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- Generated model catalog files may always be included alongside your files.
- Message format: `{feat,fix,docs}[(ai,tui,agent,cli)]: <commit message> (optionally multiple lines)`. Message is informative and concise.
- No `Co-Authored-By` trailers.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:cli`, `pkg:tui`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt.

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing interactive mode with tmux

Run the TUI in a controlled terminal (from the repo root):

```bash
tmux new-session -d -s kc-test -x 80 -y 24
tmux send-keys -t kc-test "bun run start" Enter
sleep 3 && tmux capture-pane -t kc-test -p     # capture after startup
tmux send-keys -t kc-test "your prompt here" Enter
tmux send-keys -t kc-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t kc-test
```

## Changelog and releases

Bun workspaces + **changesets**. `packages/*/CHANGELOG.md` is generated — never
edit it by hand, and never touch a released version's section.

To record a change, add a changeset (`bun x changeset`) describing it. The six
`@knightcodeai/cli*` packages are a **fixed group** in `.changeset/config.json`:
they always version and publish together. Anything listed in `ignore` must
actually exist, or changesets refuses to run at all.

Release flow is `.github/workflows/publish.yml`, on push to `main`. Never
hand-run a release or push a version tag.

1. **version** — `changesets/action` calls `bun run ci:version`
   (`scripts/ci-version.ts`): `changeset version`, then asserts the six packages
   came out lockstep and that `@knightcodeai/cli`'s `optionalDependencies` pin
   exactly that version. Drift there ships a launcher whose platform package was
   never published. While changesets are pending this only opens/updates the
   "chore(release): version packages" PR.
2. **build** — merging that PR leaves no changesets and a version not on npm, so
   the 5-target matrix compiles each binary on its own native OS and smoke tests
   it (`--version`, `doctor`). `darwin-x64` is cross-compiled from arm64 — no
   free Intel runner — so it is the one target not smoke tested.
3. **publish** — `bun run ci:publish` (`scripts/ci-publish.ts`) re-asserts
   lockstep, checks every platform package actually carries its binary, runs
   `scripts/pack-test.ts` against the real npm install path, validates each
   tarball with `npm pack --dry-run`, then publishes only what is not already on
   npm and tags the release.

Steps 1-3 are all idempotent and skip-if-published on purpose: six npm publishes
are not transactional, so a failure after the third must be safe to re-run.
`--provenance` needs `id-token: write` on the publish job.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
