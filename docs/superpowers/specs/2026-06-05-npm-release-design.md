# Phase 7 — npm-release Design Spec

## Overview

Publish `@knightcode/cli` to npm as a self-contained binary that requires no Bun
installation. Users run `npm install -g @knightcode/cli` (or `bun add -g`) and get
a working `knightcode` command on any supported platform.

---

## 1. Build Pipeline

### Approach: compiled binaries via `bun build --compile`

`bun build --compile` produces a single executable with the Bun runtime baked in.
No external runtime dependency for end users.

Five platforms (win32-arm64 deferred — negligible usage today):

| Package                        | OS     | CPU   |
| ------------------------------ | ------ | ----- |
| `@knightcode/cli-linux-x64`    | linux  | x64   |
| `@knightcode/cli-linux-arm64`  | linux  | arm64 |
| `@knightcode/cli-darwin-x64`   | darwin | x64   |
| `@knightcode/cli-darwin-arm64` | darwin | arm64 |
| `@knightcode/cli-win32-x64`    | win32  | x64   |

### Build script

`scripts/build.ts` compiles each binary and places it directly into its platform
package folder:

```
packages/cli-linux-x64/bin/knightcode    ← written by CI build, gitignored
packages/cli-darwin-arm64/bin/knightcode ← written by CI build, gitignored
...
```

Each `packages/cli-<platform>/` folder contains only a `package.json` in the repo.
The `bin/` subfolder is listed in a `.gitignore` inside each package folder so
binaries are never committed. CI builds the binary and drops it in place; `bunx
changeset publish` then publishes from the package folder directly.

### Migration embedding (define-based, opencode pattern)

The file-based Drizzle migrator (`migrationsFolder`) cannot resolve paths inside a
compiled binary. Instead the migrations are injected at build time via Bun's
`define` (the same mechanism opencode uses for `OPENCODE_MIGRATIONS`):

1. `loadMigrations()` (in `packages/cli/src/lib/store/migrations.ts`) returns a
   typed array of `{ id: string; hash: string; sql: string }`. `hash` is the
   SHA-256 of the SQL string.
2. In the **compiled binary**, the value comes from a build-time constant
   `KNIGHTCODE_MIGRATIONS`, substituted by `Bun.build({ define })` (see below).
3. In **dev** (`bun run src/index.tsx`, no define) the constant is `undefined`, so
   `loadMigrations()` falls back to reading the `.sql` files from disk. No
   generated file, no separate embed step — dev and compiled share one code path.
4. `client.ts` runs the result through the inline transactional runner in §2.

No `migrations-gen.ts`, no `embed-migrations.ts` — the disk fallback removes the
need for a generated artifact entirely.

### Version + migration injection (programmatic `Bun.build`)

`scripts/build.ts` uses the **programmatic** `Bun.build({ compile, define })` API
rather than the `bun build --compile` CLI — escaping a multi-KB migration JSON
blob on the command line is impractical, and the programmatic API is what opencode
uses for exactly this reason:

```ts
await Bun.build({
  entrypoints: ["packages/cli/src/index.tsx"],
  compile: {
    target: "bun-linux-x64",
    outfile: "packages/cli-linux-x64/bin/knightcode",
  },
  define: {
    KNIGHTCODE_VERSION: `"${version}"`, // → string literal "0.1.0"
    KNIGHTCODE_MIGRATIONS: JSON.stringify(loadMigrations()), // → array literal
  },
});
```

`KNIGHTCODE_VERSION` and `KNIGHTCODE_MIGRATIONS` are declared ambiently in
`packages/cli/src/env.d.ts` so TypeScript accepts them; code reads them behind a
`typeof … !== "undefined"` guard so dev (where they are undeclared globals) takes
the fallback path without a `ReferenceError`.

---

## 2. Migration Runner

The highest-risk part of the plan. Kept intentionally minimal — three things only:
check applied, hash guard, execute. No Drizzle internals reimplemented.

### Schema

```sql
CREATE TABLE IF NOT EXISTS __knightcode_migrations (
  id   TEXT PRIMARY KEY,
  hash TEXT NOT NULL
);
```

### Runner logic

Each migration is wrapped in an explicit transaction. If the SQL fails halfway
through, the entire migration is rolled back and the migration row is never
inserted. The DB stays consistent.

```
function runMigrations(db, migrations):
  ensureMigrationsTable(db)
  applied = db.query("SELECT id, hash FROM __knightcode_migrations").all()
  appliedSet = Map(applied, id → hash)

  for migration of migrations (sorted by id):
    if appliedSet.has(migration.id):
      if appliedSet.get(migration.id) !== migration.hash:
        throw "Migration ${migration.id} hash mismatch — db may be corrupt"
      continue  // already applied

    db.exec("BEGIN")
    try:
      db.exec(migration.sql)
      db.run("INSERT INTO __knightcode_migrations (id, hash) VALUES (?, ?)",
             migration.id, migration.hash)
      db.exec("COMMIT")
    catch err:
      db.exec("ROLLBACK")
      throw err
```

SQLite transactions are cheap. A partial migration leaving the DB in an unknown
state is not acceptable — transactions prevent this entirely.

---

## 3. Checksum Verification (deferred post-v0.1.0)

Generating SHA-256 checksums per binary and verifying them in the launcher before
spawning is a reasonable security measure. However the threat model it defends
against — binary modified while the npm package remains intact — is unlikely enough
that the startup complexity cost is not justified at v0.1.0.

Every line of launcher code is technical debt. The update checker, `doctor`, and
smoke tests provide stronger practical value at this stage.

**Deferred.** Revisit after v0.1.0 ships. If implementation stays under ~50 lines
it is worth adding; otherwise it stays out.

---

## 4. Package Structure

### Platform packages in repo (stubs)

Five platform packages live in `packages/` as stub folders — just a `package.json`,
no binary committed:

```
packages/
  cli/                    @knightcode/cli          — source + main package
  cli-linux-x64/          package.json only (bin/ gitignored)
  cli-linux-arm64/        package.json only
  cli-darwin-x64/         package.json only
  cli-darwin-arm64/       package.json only
  cli-win32-x64/          package.json only
  shared/                 private — never published
```

This is required for Changesets to version them. Changesets reads `package.json`
from the repo; if the files don't exist in the repo, they can't participate in the
fixed group (see §7).

Each platform `package.json`:

```json
{
  "name": "@knightcode/cli-darwin-arm64",
  "version": "0.1.0",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "preferUnplugged": true,
  "files": ["bin/"]
}
```

Each platform folder has a `.gitignore` containing `/bin/` so compiled binaries
are never committed.

`preferUnplugged: true` prevents package managers from keeping the binary in a zip
— required for the binary to be executable on disk.

### Main package changes

`packages/cli/package.json`:

- Remove `"private": true`
- Set `"version": "0.1.0"`
- Add `"files": ["bin/", "README.md"]`
- Add `"optionalDependencies"` for all 5 platform packages at the same version
- Add `"engines": { "node": ">=16" }` — the launcher uses only stable Node APIs
  (`require.resolve`, `child_process.spawn`, `os`) available since Node 16 LTS
- Remove `@knightcode/shared` workspace dep (bundled into the binary at build time)
- Remove the `dotenv` block from `bin/knightcode`

### Main bin launcher

`bin/knightcode` is a plain Node.js script. Uses `require.resolve` to locate the
platform binary — no filesystem traversal:

```js
const pkg = `@knightcode/cli-${platform}-${arch}`;
const binaryPath = require.resolve(`${pkg}/bin/knightcode`);
```

Works correctly with pnpm, yarn, npm workspaces, and handles symlinks
transparently. After resolving, spawns the binary forwarding all args and signals.

---

## 5. Version Flag and Update Notifications

### `--version` flag

`src/index.tsx` handles `--version` / `-v` before mounting the TUI. Reads
`KNIGHTCODE_VERSION` and prints it, then exits:

```
$ knightcode --version
0.1.0
```

### Update check

Cache file `~/.knightcode/update-check.json`:

```json
{
  "lastChecked": 1749080000,
  "latestVersion": "0.2.0"
}
```

Startup behaviour — strictly non-blocking:

1. Read cache file (sync, instant)
2. If `latestVersion > KNIGHTCODE_VERSION` → render update banner immediately from
   cached data, no network wait
3. If cache is missing or `lastChecked` is more than 24h ago → fire async background
   fetch to `https://registry.npmjs.org/@knightcode/cli/latest` (1500ms timeout),
   write result to cache for the next launch
4. Skipped entirely when `KNIGHTCODE_NO_UPDATE_CHECK=1`
5. Network errors silently swallowed — stale cache is fine

The banner always comes from the cache, never from a live fetch during the current
session. A slow or offline npm registry never touches startup time.

### TUI integration

When an update is available:

1. **Status bar** (`components/status-bar.tsx`) — appended to the mode/model/ctx row:

   ```
   Build › model-name  •  ctx: 85%  •  ★ v0.2.0 available
   ```

2. **Home screen** (`screens/home.tsx`) — dim line after the hints row:
   ```
   / for commands   @ for files   tab for mode
   ★ Update available: v0.2.0  •  npm install -g @knightcode/cli
   ```

`StatusBar` gets an optional `updateVersion?: string` prop. A `useUpdateCheck()`
hook reads the cached state and provides it to both locations. Does not surface
mid-reply.

---

## 6. `knightcode doctor`

A hidden debug command — not in `--help` output but always available. Invaluable
when users file issues.

```
$ knightcode doctor

Version:        0.1.0
Platform:       darwin-arm64
Config dir:     ~/.knightcode
Database:       OK  (~/.knightcode/knightcode.db)
API key:        configured (OpenRouter)
Model:          anthropic/claude-sonnet-4-5
Update check:   enabled (last checked 2h ago)
```

If something is wrong, the relevant line shows `FAIL` with a one-line reason:

```
Database:       FAIL  (cannot open ~/.knightcode/knightcode.db — permission denied)
API key:        not configured  (run: knightcode)
```

Implementation: a `/doctor` slash command in the CLI that renders a plain-text
summary and exits. Not part of the TUI session flow — runs headlessly and prints
to stdout. Can be called from a terminal without launching the full TUI.

Not required for first publish but plan for it in Phase 7.

---

## 7. GitHub Actions Workflow

File: `.github/workflows/publish.yml`

**Single trigger: Changesets only.** No manual tag trigger. One mechanism,
no risk of double-publishing.

Uses the standard `changesets/action` pattern — the action itself decides whether
to open/update the Version Packages PR or publish, based on the current state of
`.changeset/` and the registry. No custom version-check logic to maintain.

```yaml
on:
  push:
    branches:
      - main

jobs:
  release:
    steps:
      - uses: changesets/action@v1
        with:
          publish: bun run ci:publish # runs the build matrix + bunx changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`ci:publish` is a script in the root `package.json` that triggers the build matrix
and `bunx changeset publish`. The action handles the branching logic internally.

### `build` job (matrix, parallel)

| Target                   | Runner           |
| ------------------------ | ---------------- |
| linux-x64, linux-arm64   | `ubuntu-latest`  |
| darwin-x64, darwin-arm64 | `macos-latest`   |
| win32-x64                | `windows-latest` |

linux-arm64 cross-compiles via Bun's `--target` from the ubuntu runner.

Each matrix job:

1. `oven-sh/setup-bun@v2`
2. `bun install`
3. `bun run scripts/embed-migrations.ts`
4. `bun run scripts/build.ts --target <platform>` → binary lands in
   `packages/cli-<platform>/bin/`
5. **Smoke test:**
   - `knightcode --version` must print the expected version string exactly
   - `knightcode doctor` must exit 0 and print a parseable status block
   - Both are explicitly headless — no TUI mount, no terminal required
   - Failure here aborts the entire publish
6. Upload `packages/cli-<platform>/` as artifact

### `pack-test` job (after all builds pass, before publish)

Validates the full install path — not just the binary, but the packaging itself.
Most release bugs are not a broken binary; they're a wrong `files` field, missing
`optionalDependency`, bad `bin` entry, or a launcher that can't resolve the
platform package.

Runs on `ubuntu-latest` (linux-x64 binary available from the build matrix):

```
npm pack  (from packages/cli/)
npm install -g ./knightcode-0.1.0.tgz
knightcode --version   → must match expected version
knightcode doctor      → must exit 0
```

This catches packaging bugs that binary smoke tests cannot.

### `publish` job (after pack-test passes)

1. Download all 5 artifacts (each restores the `bin/` into the package folder)
2. `bunx changeset publish` — publishes all packages Changesets considers unpublished

Uses `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

---

### GitHub Releases

`@changesets/action` is configured with `createGithubReleases: true`. Each time
the Version Packages PR merges and packages publish, a GitHub Release is created
automatically at `github.com/<user>/knightcode/releases` with:

- Tag: `@knightcode/cli@0.1.0`
- Body: the CHANGELOG.md entry for that version

Users can browse releases, read what changed per version, and link to specific
releases in issue responses.

---

## 8. Version Management and Changelog — Changesets

### Why Changesets

All 6 packages must release at the same version. Changesets "fixed" groups handle
this natively, and the package stubs in `packages/` give it the manifests it needs
to version them.

### Changelog

When the Changesets bot creates the Version Packages PR, it:

1. Reads all `.changeset/*.md` files (one per merged feature)
2. Groups entries and writes them to `packages/cli/CHANGELOG.md`
3. Bumps all 6 `package.json` files to the new version
4. Deletes the consumed changeset files

Only `packages/cli/CHANGELOG.md` gets entries — platform packages don't need
individual changelogs since they carry no user-visible changes of their own.

Example changelog entry:

```markdown
# @knightcode/cli

## 0.2.0

### Minor Changes

- Added support for new model xyz
- Improved streaming performance
```

### `config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [
    [
      "@knightcode/cli",
      "@knightcode/cli-linux-x64",
      "@knightcode/cli-linux-arm64",
      "@knightcode/cli-darwin-x64",
      "@knightcode/cli-darwin-arm64",
      "@knightcode/cli-win32-x64"
    ]
  ],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@knightcode/shared"]
}
```

### Developer workflow

After finishing work on a branch:

```bash
bunx changeset
# → pick patch / minor / major, write one sentence
# → creates .changeset/<random-name>.md
git add .changeset/
git commit -m "chore: add changeset"
```

### Full release flow

```
1. Finish feature on branch
2. bunx changeset  →  bump type + one sentence
3. Push + open PR  →  CodeRabbit + Codex review
4. Merge PR → Changesets bot opens Version Packages PR
5. Review: versions correct? changelog looks right?
6. Merge Version PR
   → build matrix + smoke tests + publish all 6 packages
   → CHANGELOG.md committed to main
```

---

## 9. Pre-implementation Spike

**This is the GO/NO-GO gate before any distribution infrastructure (platform
packages, launcher, Changesets, CI).**

A raw `bun build --compile` of the current source cannot pass the "migrations run"
check — the file-based Drizzle migrator is exactly what breaks in a compiled
binary. So the spike runs _after_ the migration-embedding loader, the version
constant, and a minimal single-platform `build.ts` exist (it builds via the real
pipeline, with migrations + version injected through `define`):

```bash
bun run scripts/build.ts --single   # compiles current platform only

./packages/cli-<platform>/bin/knightcode --version
./packages/cli-<platform>/bin/knightcode doctor
./packages/cli-<platform>/bin/knightcode
```

Test matrix — verify each item on Linux, macOS, and Windows:

| Check                                                                  | Why                                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--version` prints correctly                                           | `--define` injection works                                                                                                                                  |
| `doctor` exits 0                                                       | headless path works post-compile                                                                                                                            |
| SQLite opens + migrations run                                          | `bun:sqlite` works in compiled binary                                                                                                                       |
| Config dir `~/.knightcode/` created                                    | `paths.ts` resolves correctly                                                                                                                               |
| TUI renders                                                            | OpenTUI works in compiled binary                                                                                                                            |
| OpenRouter request streams                                             | network + streaming work post-compile                                                                                                                       |
| `npm pack` → `npm install -g ./tarball` → `knightcode --version` works | validates `optionalDependencies`, `bin` entry, and `require.resolve()` launcher — the binary can work perfectly while the package layout breaks the install |

If all six pass on all three platforms, the rest of Phase 7 is plumbing. If any
fail, the spike surfaces the problem before the CI infrastructure is built around
a broken assumption.

The spike does not need to be committed — it is throwaway validation work.

---

## 10. README

`packages/cli/README.md`:

- Install: `npm install -g @knightcode/cli`
- Prerequisites: none (Bun runtime bundled)
- Quick start: `knightcode`
- Config: `~/.knightcode/`
- `KNIGHTCODE_NO_UPDATE_CHECK=1` to disable update checks
- `knightcode doctor` for diagnostics

---

## 11. Pre-publish Checklist

One-time setup:

1. Create npm org `knightcode` at npmjs.com
2. Generate Automation token on npmjs.com
3. Add `NPM_TOKEN` → GitHub repo Settings → Secrets → Actions
4. Give workflow `GITHUB_TOKEN` write permission (Changesets bot needs it)
5. Install Changesets bot: https://github.com/apps/changeset-bot
6. Create the 5 stub platform package folders with `package.json` + `.gitignore`

First release:

7. `bunx changeset init` → creates `.changeset/config.json`
8. `bunx changeset` → pick `minor`
9. Build locally + `npm publish --dry-run` from one platform folder to verify
   file manifest
10. Merge the Version Packages PR → workflow publishes v0.1.0
11. `npm install -g @knightcode/cli && knightcode --version` on a clean machine
