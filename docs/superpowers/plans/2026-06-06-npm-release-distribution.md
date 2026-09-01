# npm Release Distribution (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@knightcode/cli` installable from npm as a self-contained compiled binary — `npm install -g @knightcode/cli` works on all five supported platforms with no Bun required.

**Architecture:** Five thin platform packages each ship one `bun build --compile` binary (built into their `bin/`, gitignored, dropped in by CI). The main `@knightcode/cli` package ships only a dependency-free Node launcher that `require.resolve`s the correct platform binary and spawns it, forwarding args/signals/exit codes. All six packages version together as a Changesets "fixed" group; a single GitHub Actions workflow driven by `changesets/action` opens the Version PR and, on its merge, cross-compiles all five binaries from one runner and publishes.

**Tech Stack:** Bun (`Bun.build` programmatic compile + cross-compile), Node (CommonJS launcher), Changesets (versioning + publish), GitHub Actions (`changesets/action@v1`, `oven-sh/setup-bun`, `actions/setup-node`), npm registry.

---

## Context: what Plan A already delivered (do NOT redo)

On this branch (`npm-release-foundation`):

- `scripts/build.ts` — programmatic `Bun.build({ compile, define })`, injects `KNIGHTCODE_VERSION` + `KNIGHTCODE_MIGRATIONS`. Currently writes to `dist/<os>-<arch>/`. `--single` filters to the current platform; default builds all 5 targets. Already aborts on empty migrations and types `bunTarget` as `Bun.Build.CompileTarget`.
- `packages/cli/src/lib/store/migrations.ts` — `readMigrationsFromDisk()` (used by build.ts), `loadMigrations()` (embed-or-disk).
- Headless `--version` and `doctor` (`src/index.tsx` dispatcher → `tui-main.tsx`), update-check, etc.
- `packages/cli/package.json` is still `"private": true`, no `version`, heavy runtime `dependencies`.
- `packages/cli/bin/knightcode` is still the old `#!/usr/bin/env bun` + dotenv shim.

Plan B is the distribution plumbing layered on top.

---

## Key decisions (deviations from / clarifications of the spec)

These are deliberate engineering calls. Each is safe to revisit, but the plan assumes them.

1. **Single-runner cross-compile, not a 3-OS build matrix.** Bun cross-compiles every target from one machine (`--target bun-darwin-arm64` etc.), which opencode relies on. So the release job builds all five binaries on `ubuntu-latest` inside `ci:publish` and publishes. The spec's per-OS matrix with *native* smoke tests is simplified to: cross-compile all five + a `pack-test` gate that installs and runs the **linux-x64** binary on its native runner. **Native per-platform smoke tests (running the darwin/win32 binaries on their own OS) are deferred** — the GO/NO-GO gate already proved the compiled binary works, and migration/doctor/version paths are platform-agnostic Bun behavior.

2. **Bundled runtime deps move to `devDependencies`.** The compiled binary bundles everything at build time, so the *published* main package must declare **zero** runtime `dependencies` — only `optionalDependencies` (the platform packages). Two reasons this is mandatory: (a) workspace deps like `@knightcode/shared` are unpublished and would hard-fail a user's `npm install`; (b) bundled libs (`ai`, `@opentui/*`, `react`, …) would bloat the install by 100 MB+ for no reason. Moving them to `devDependencies` keeps dev + `bun build` working (Bun resolves from `node_modules` regardless of dependency type) while npm consumers ignore them.

3. **`optionalDependencies` use literal versions in a fixed group — not `workspace:*`.** `changeset publish` shells out to `npm publish`, and npm does **not** understand the `workspace:` protocol, so a `workspace:*` range would be published literally and break installs. Literal versions (`0.0.0`, bumped in lockstep by the fixed group) survive `npm publish` unchanged.

4. **Initial versions are `0.0.0` + one `minor` changeset → first release is `0.1.0`.** This exercises the real Version-PR → publish pipeline for the very first release (rather than hand-publishing 0.1.0). The spec's `0.1.0` package.json examples show the post-bump state.

5. **Binaries are gitignored via the ROOT `.gitignore` (`packages/cli-*/bin/`), not a per-package `.gitignore`.** npm pack, when a package folder contains a local `.gitignore` and no `.npmignore`, uses that `.gitignore` as a denylist — which would silently **exclude the binary from the published tarball** even though it's in `files`. Keeping the ignore rule in the root `.gitignore` (which npm pack does not consult) means the `files: ["bin/"]` allowlist includes the binary cleanly. `pack-test` packs via the real `npm pack` path and will catch this if it regresses.

6. **Launcher maps `process.platform`/`process.arch` directly.** Node reports `linux`/`darwin`/`win32` and `x64`/`arm64`, which already match our package suffixes — no translation table needed. We adopt opencode's signal-forwarding `run()` verbatim.

**Integration points only fully verifiable on the first CI run** (locally we validate as far as possible via `pack-test`): the Changesets fixed-group version bump writing correct `optionalDependencies` ranges, npm auth via `NODE_AUTH_TOKEN`/`.npmrc`, and automatic GitHub Release creation. The first Version PR is itself a human review gate before anything publishes.

---

## File Structure

| File | Responsibility | Action |
| ---- | -------------- | ------ |
| `packages/cli-linux-x64/package.json` | Stub manifest for the linux-x64 binary | Create |
| `packages/cli-linux-arm64/package.json` | Stub manifest for linux-arm64 | Create |
| `packages/cli-darwin-x64/package.json` | Stub manifest for darwin-x64 | Create |
| `packages/cli-darwin-arm64/package.json` | Stub manifest for darwin-arm64 | Create |
| `packages/cli-win32-x64/package.json` | Stub manifest for win32-x64 | Create |
| `.gitignore` (root) | Ignore compiled platform binaries | Modify |
| `packages/cli/bin/knightcode` | Dependency-free Node launcher (`require.resolve` + spawn) | Rewrite |
| `scripts/build.ts` | Emit binaries into platform package `bin/`, set exec bit | Modify |
| `packages/cli/package.json` | Publishable manifest (un-private, version, files, optionalDeps, engines, deps→devDeps) | Modify |
| `package.json` (root) | `@changesets/cli` devDep, `ci:version`/`ci:publish`, repoint `build:cli` | Modify |
| `scripts/pack-test.ts` | End-to-end packaging validation (pack → install → run) | Create |
| `.changeset/config.json` | Changesets fixed-group config | Create |
| `.changeset/README.md` | Changesets folder readme (init artifact) | Create |
| `.github/workflows/publish.yml` | Release workflow (`changesets/action`) | Create |
| `packages/cli/README.md` | npm package readme | Create |
| `.changeset/<name>.md` | Initial `minor` changeset → 0.1.0 | Create |

---

## Task 1: Platform package stubs + root binary gitignore

**Files:**
- Create: `packages/cli-linux-x64/package.json`
- Create: `packages/cli-linux-arm64/package.json`
- Create: `packages/cli-darwin-x64/package.json`
- Create: `packages/cli-darwin-arm64/package.json`
- Create: `packages/cli-win32-x64/package.json`
- Modify: `.gitignore` (root)

- [ ] **Step 1: Create the five stub manifests**

`packages/cli-linux-x64/package.json`:

```json
{
  "name": "@knightcode/cli-linux-x64",
  "version": "0.0.0",
  "os": ["linux"],
  "cpu": ["x64"],
  "preferUnplugged": true,
  "files": ["bin/"]
}
```

`packages/cli-linux-arm64/package.json`:

```json
{
  "name": "@knightcode/cli-linux-arm64",
  "version": "0.0.0",
  "os": ["linux"],
  "cpu": ["arm64"],
  "preferUnplugged": true,
  "files": ["bin/"]
}
```

`packages/cli-darwin-x64/package.json`:

```json
{
  "name": "@knightcode/cli-darwin-x64",
  "version": "0.0.0",
  "os": ["darwin"],
  "cpu": ["x64"],
  "preferUnplugged": true,
  "files": ["bin/"]
}
```

`packages/cli-darwin-arm64/package.json`:

```json
{
  "name": "@knightcode/cli-darwin-arm64",
  "version": "0.0.0",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "preferUnplugged": true,
  "files": ["bin/"]
}
```

`packages/cli-win32-x64/package.json`:

```json
{
  "name": "@knightcode/cli-win32-x64",
  "version": "0.0.0",
  "os": ["win32"],
  "cpu": ["x64"],
  "preferUnplugged": true,
  "files": ["bin/"]
}
```

- [ ] **Step 2: Add the binary ignore rule to the root `.gitignore`**

Append to the repo-root `.gitignore`:

```gitignore
# Compiled platform binaries (built by CI / scripts/build.ts, never committed)
packages/cli-*/bin/
```

- [ ] **Step 3: Verify the workspace picks up the new packages**

Run: `bun install`
Expected: completes without error; `bun pm ls 2>&1 | grep knightcode` (or inspect `node_modules/@knightcode`) shows the five `@knightcode/cli-<platform>` packages symlinked.

- [ ] **Step 4: Verify the manifests are valid JSON and named correctly**

Run (PowerShell): `Get-ChildItem packages/cli-* -Directory | ForEach-Object { (Get-Content "$($_.FullName)/package.json" -Raw | ConvertFrom-Json).name }`
Expected: prints the five names `@knightcode/cli-linux-x64` … `@knightcode/cli-win32-x64`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli-linux-x64 packages/cli-linux-arm64 packages/cli-darwin-x64 packages/cli-darwin-arm64 packages/cli-win32-x64 .gitignore
git commit -m "feat(release): platform package stubs for @knightcode/cli"
```

---

## Task 2: Dependency-free Node launcher

The launcher is plain CommonJS run by Node. It must be extensionless (`bin/knightcode`) so Node loads it as CommonJS even though `packages/cli/package.json` is `"type": "module"`. It uses only Node builtins.

**Files:**
- Rewrite: `packages/cli/bin/knightcode`

- [ ] **Step 1: Replace the launcher contents**

`packages/cli/bin/knightcode`:

```js
#!/usr/bin/env node
// Dependency-free launcher: resolves the platform-specific compiled binary
// (shipped as an optional dependency) and spawns it, forwarding args, stdio,
// signals, and the exit code. Must stay CommonJS + builtins only.
const childProcess = require("child_process");

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];

function run(target) {
  const child = childProcess.spawn(target, process.argv.slice(2), {
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  const forwarders = {};
  for (const signal of forwardedSignals) {
    forwarders[signal] = () => {
      try {
        child.kill(signal);
      } catch {
        // The child may have already exited.
      }
    };
    process.on(signal, forwarders[signal]);
  }

  child.on("exit", (code, signal) => {
    for (const s of forwardedSignals) process.removeListener(s, forwarders[s]);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(typeof code === "number" ? code : 0);
  });
}

const pkg = `@knightcode/cli-${process.platform}-${process.arch}`;
const binary = process.platform === "win32" ? "knightcode.exe" : "knightcode";

let target = process.env.KNIGHTCODE_BIN_PATH;
if (!target) {
  try {
    target = require.resolve(`${pkg}/bin/${binary}`);
  } catch {
    console.error(
      `knightcode: no prebuilt binary for ${process.platform}-${process.arch}.\n` +
        `Your package manager may have skipped the optional dependency "${pkg}".\n` +
        `Try reinstalling: npm install -g @knightcode/cli`,
    );
    process.exit(1);
  }
}

run(target);
```

- [ ] **Step 2: Verify it parses as CommonJS under Node**

Run: `node --check packages/cli/bin/knightcode`
Expected: no output, exit 0 (syntax OK as CommonJS).

- [ ] **Step 3: Verify the not-found path prints a helpful error**

The platform binary does not exist yet (Task 3 builds it), so running the launcher now exercises the failure branch.
Run: `node packages/cli/bin/knightcode --version`
Expected: prints the `no prebuilt binary` message and exits 1 (because `@knightcode/cli-<platform>-<arch>/bin/...` has no binary yet).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/bin/knightcode
git commit -m "feat(release): require.resolve launcher with signal forwarding"
```

---

## Task 3: Build into platform package folders + executable bit

**Files:**
- Modify: `scripts/build.ts`

- [ ] **Step 1: Point the output at the platform package `bin/` and set the exec bit**

Replace the output loop in `scripts/build.ts`. The current loop writes to `dist/<os>-<arch>/`; change `outDir` to `packages/cli-<os>-<arch>/bin` and `chmod` the binary on POSIX. Also drop the now-obsolete `dist` reference.

Replace this block:

```ts
for (const target of targets) {
  const outDir = join(ROOT, "dist", `${target.os}-${target.arch}`);
  mkdirSync(outDir, { recursive: true });
  const binName = target.os === "win32" ? "knightcode.exe" : "knightcode";
  const outfile = join(outDir, binName);

  console.log(`Building ${target.os}-${target.arch} → ${outfile}`);
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    compile: { target: target.bunTarget, outfile },
    define: {
      KNIGHTCODE_VERSION: JSON.stringify(version),
      KNIGHTCODE_MIGRATIONS: JSON.stringify(migrations),
    },
  });

  if (!result.success) {
    console.error(`Build failed for ${target.os}-${target.arch}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}
```

with:

```ts
for (const target of targets) {
  const outDir = join(ROOT, "packages", `cli-${target.os}-${target.arch}`, "bin");
  mkdirSync(outDir, { recursive: true });
  const binName = target.os === "win32" ? "knightcode.exe" : "knightcode";
  const outfile = join(outDir, binName);

  console.log(`Building ${target.os}-${target.arch} → ${outfile}`);
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    compile: { target: target.bunTarget, outfile },
    define: {
      KNIGHTCODE_VERSION: JSON.stringify(version),
      KNIGHTCODE_MIGRATIONS: JSON.stringify(migrations),
    },
  });

  if (!result.success) {
    console.error(`Build failed for ${target.os}-${target.arch}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  // Compiled binaries must be executable on POSIX (npm preserves the mode bit).
  if (target.os !== "win32") chmodSync(outfile, 0o755);
}
```

- [ ] **Step 2: Import `chmodSync`**

Change the fs import at the top of `scripts/build.ts` from:

```ts
import { mkdirSync } from "node:fs";
```

to:

```ts
import { chmodSync, mkdirSync } from "node:fs";
```

- [ ] **Step 3: Build the current platform and confirm placement**

Run: `bun run scripts/build.ts --single`
Expected: logs `Embedding N migration(s), version 0.0.0` then `Building win32-x64 → …packages\cli-win32-x64\bin\knightcode.exe` (or your platform's equivalent), ending `Build complete.`

- [ ] **Step 4: Confirm the binary now runs through the launcher**

Run: `node packages/cli/bin/knightcode --version`
Expected: prints `0.0.0` (the launcher resolved `@knightcode/cli-<platform>-<arch>/bin/...` — the workspace symlink — and spawned it). On a fresh checkout `process.arch` must be `x64` for this to resolve to `cli-win32-x64`.

- [ ] **Step 5: Confirm doctor runs through the launcher**

Run: `node packages/cli/bin/knightcode doctor`
Expected: prints the doctor report and exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/build.ts
git commit -m "feat(release): compile binaries into platform package bin/ with exec bit"
```

---

## Task 4: Publishable main package manifest

Turn `packages/cli/package.json` into a thin, publishable manifest. Move all current runtime `dependencies` into `devDependencies`, drop `private`, add `version`/`files`/`engines`/`optionalDependencies`, drop `peerDependencies` and the obsolete `module`/`build` fields. Also repoint the root `build:cli` script (it referenced the removed `build` script).

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `package.json` (root) — repoint `build:cli`

- [ ] **Step 1: Replace `packages/cli/package.json` entirely**

```json
{
  "name": "@knightcode/cli",
  "version": "0.0.0",
  "type": "module",
  "bin": {
    "knightcode": "./bin/knightcode"
  },
  "files": ["bin/", "README.md"],
  "engines": {
    "node": ">=16"
  },
  "optionalDependencies": {
    "@knightcode/cli-linux-x64": "0.0.0",
    "@knightcode/cli-linux-arm64": "0.0.0",
    "@knightcode/cli-darwin-x64": "0.0.0",
    "@knightcode/cli-darwin-arm64": "0.0.0",
    "@knightcode/cli-win32-x64": "0.0.0"
  },
  "scripts": {
    "dev": "bun run --watch src/index.tsx",
    "check-types": "tsc --noEmit",
    "test": "bun test src/**/*.test.ts"
  },
  "devDependencies": {
    "@ai-sdk/provider-utils": "^4.0.27",
    "@ai-sdk/react": "^3.0.193",
    "@knightcode/shared": "workspace:*",
    "@openrouter/ai-sdk-provider": "^2.9.0",
    "@opentui/core": "^0.2.10",
    "@opentui/react": "^0.2.10",
    "@repo/eslint-config": "*",
    "@repo/typescript-config": "workspace:*",
    "@types/bun": "latest",
    "@types/html-to-text": "^9.0.4",
    "@types/react": "^19.2.6",
    "ai": "^6.0.191",
    "date-fns": "^4.3.0",
    "drizzle-kit": "^0.31.10",
    "drizzle-orm": "^0.45.2",
    "hono": "^4.12.12",
    "html-to-text": "^10.0.0",
    "open": "^11.0.0",
    "opentui-spinner": "^0.0.6",
    "pretty-ms": "^9.3.0",
    "react": "^19.2.6",
    "react-router": "7.14.2",
    "safe-regex": "^2.1.1",
    "typescript": "^5",
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 2: Repoint `build:cli` in the root `package.json`**

In the root `package.json` `scripts`, change:

```json
    "build:cli": "bun run --filter @knightcode/cli build",
```

to:

```json
    "build:cli": "bun run scripts/build.ts --single",
```

- [ ] **Step 3: Reinstall so the workspace graph reflects the manifest change**

Run: `bun install`
Expected: completes without error (workspace symlinks for `@knightcode/shared`, `@repo/*`, and the platform packages remain).

- [ ] **Step 4: Verify dev tooling still resolves everything**

Run: `cd packages/cli; bun run check-types`
Expected: exit 0 (TypeScript still resolves `react`, `ai`, `@opentui/*`, etc. from `devDependencies`).

- [ ] **Step 5: Verify the compile still bundles all (now-dev) deps**

Run: `bun run scripts/build.ts --single`
Expected: `Build complete.` — Bun resolves the bundled libraries from `node_modules` regardless of dependency classification.

- [ ] **Step 6: Verify the full test suite still passes**

Run: `cd packages/cli; bun test`
Expected: all tests pass (284+), 0 fail.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/package.json package.json
git commit -m "feat(release): publishable @knightcode/cli manifest (thin runtime, platform optionalDeps)"
```

---

## Task 5: End-to-end packaging validation (`pack-test.ts`)

A script that packs the main package + the current-platform package with the **real `npm pack`** path, installs both local tarballs into a temp project, and runs the launcher through them. This catches packaging bugs (wrong `files`, gitignore-excluded binary, bad `bin`, launcher resolution) that binary smoke tests cannot. It is also reused as the pre-publish gate in `ci:publish`.

**Files:**
- Create: `scripts/pack-test.ts`

- [ ] **Step 1: Write the pack-test script**

`scripts/pack-test.ts`:

```ts
// scripts/pack-test.ts — validate the published install end-to-end, locally.
// Packs the main package + the current-platform package via real `npm pack`,
// installs both tarballs into a throwaway project, and runs the launcher.
import { $ } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";

const ROOT = join(import.meta.dir, "..");
const platform = process.platform;
const arch = process.arch;
const expectedVersion = pkg.version;

const mainDir = join(ROOT, "packages", "cli");
const platformDir = join(ROOT, "packages", `cli-${platform}-${arch}`);
const binName = platform === "win32" ? "knightcode.exe" : "knightcode";
const binPath = join(platformDir, "bin", binName);

if (!existsSync(platformDir)) {
  console.error(`No platform package for ${platform}-${arch} (${platformDir})`);
  process.exit(1);
}

// Ensure the current-platform binary exists; build it if missing.
if (!existsSync(binPath)) {
  console.log("Binary missing — building current platform...");
  await $`bun run ${join(ROOT, "scripts", "build.ts")} --single`.cwd(ROOT);
}

const work = mkdtempSync(join(tmpdir(), "kc-packtest-"));
const proj = join(work, "proj");
await $`mkdir -p ${proj}`.nothrow();

try {
  // Pack both packages into the temp dir (npm prints the tarball filename).
  const mainTgz = (
    await $`npm pack --silent --pack-destination ${work}`.cwd(mainDir).text()
  ).trim();
  const platformTgz = (
    await $`npm pack --silent --pack-destination ${work}`.cwd(platformDir).text()
  ).trim();

  await $`npm init -y`.cwd(proj);
  // Install both local tarballs together so the optionalDependency is satisfied
  // locally (the registry has nothing yet).
  await $`npm install --no-audit --no-fund ${join(work, mainTgz)} ${join(work, platformTgz)}`.cwd(
    proj,
  );

  const launcher = join(
    proj,
    "node_modules",
    "@knightcode",
    "cli",
    "bin",
    "knightcode",
  );

  // --version must print exactly the package version.
  const version = (await $`node ${launcher} --version`.cwd(proj).text()).trim();
  if (version !== expectedVersion) {
    throw new Error(
      `--version mismatch: got "${version}", expected "${expectedVersion}"`,
    );
  }
  console.log(`✓ --version → ${version}`);

  // doctor must exit 0.
  const doctor = await $`node ${launcher} doctor`.cwd(proj).nothrow();
  if (doctor.exitCode !== 0) {
    throw new Error(`doctor exited ${doctor.exitCode}`);
  }
  console.log("✓ doctor exit 0");

  console.log(`pack-test passed for ${platform}-${arch}`);
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // Windows may hold a handle on the temp sqlite db — OS reaps it.
  }
}
```

- [ ] **Step 2: Run pack-test on the current platform**

Run: `bun run scripts/pack-test.ts`
Expected: prints `✓ --version → 0.0.0`, `✓ doctor exit 0`, `pack-test passed for win32-x64` (or your platform). A failure here means a packaging bug — most likely the binary was excluded from the tarball (check decision #5) or `files`/`bin` is wrong.

- [ ] **Step 3: Commit**

```bash
git add scripts/pack-test.ts
git commit -m "test(release): end-to-end pack/install/run packaging validation"
```

---

## Task 6: Changesets config + release scripts

**Files:**
- Modify: `package.json` (root) — add `@changesets/cli` devDep + `ci:version`/`ci:publish`
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`

- [ ] **Step 1: Add `@changesets/cli` and the CI scripts to the root `package.json`**

Add to root `devDependencies`:

```json
    "@changesets/cli": "^2.27.10",
```

Add to root `scripts`:

```json
    "ci:version": "changeset version && bun install",
    "ci:publish": "bun run scripts/build.ts && bun run scripts/pack-test.ts && changeset publish",
```

(`ci:version` refreshes `bun.lock` after the version bump so the Version PR commits a consistent lockfile. `ci:publish` builds all five binaries, gates on pack-test, then publishes.)

- [ ] **Step 2: Create `.changeset/config.json`**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
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

- [ ] **Step 3: Create `.changeset/README.md`**

```markdown
# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release:

```bash
bunx changeset
```

Pick a bump type (patch/minor/major) and write one sentence. Commit the generated
`.changeset/*.md` file with your PR. On merge to `main`, the Changesets bot opens a
"Version Packages" PR; merging that PR publishes all `@knightcode/cli*` packages.
```

- [ ] **Step 4: Install and verify the changeset CLI resolves**

Run: `bun install`
Then: `bunx changeset status --since=main 2>&1 | head -5` (or `bunx changeset status`)
Expected: the command runs (it may report "No changesets present" — that's fine; it confirms config parses and the fixed group is recognized).

- [ ] **Step 5: Commit**

```bash
git add package.json .changeset/config.json .changeset/README.md
git commit -m "build(release): changesets fixed-group config + ci:version/ci:publish"
```

---

## Task 7: GitHub Actions publish workflow

Single workflow on push to `main`. `changesets/action` decides whether to open/update the Version PR or publish, based on `.changeset/` state.

**Files:**
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create the workflow**

`.github/workflows/publish.yml`:

```yaml
name: publish

on:
  push:
    branches:
      - main

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write # push the Version PR branch + create tags/releases
  pull-requests: write # open/update the Version Packages PR

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.3

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"

      - run: bun install --frozen-lockfile

      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          version: bun run ci:version
          publish: bun run ci:publish
          commit: "chore(release): version packages"
          title: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Notes for the engineer:
- `actions/setup-node` with `registry-url` writes `~/.npmrc` so `npm publish` (invoked by `changeset publish`) authenticates via `NODE_AUTH_TOKEN`.
- The build (all five targets) + pack-test run **inside `ci:publish`**, so they only execute when the action actually publishes (i.e., when the Version PR merges), not when it merely opens/updates the Version PR.
- `changesets/action` creates GitHub Releases automatically when publishing succeeds (requires `contents: write`, which is granted).

- [ ] **Step 2: Validate the workflow YAML**

If `actionlint` is available: `actionlint .github/workflows/publish.yml` → expect no errors.
Otherwise validate it parses (PowerShell, requires the `powershell-yaml` module is **not** assumed — use bun instead):
Run: `bun -e "import('js-yaml').then(y=>y.load(require('fs').readFileSync('.github/workflows/publish.yml','utf8'))).then(()=>console.log('yaml ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `yaml ok`. (If `js-yaml` isn't installed, skip — visual review of indentation suffices; this file is config, not executable here.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci(release): changesets publish workflow"
```

---

## Task 8: Package README

**Files:**
- Create: `packages/cli/README.md`

- [ ] **Step 1: Write the README**

`packages/cli/README.md`:

```markdown
# @knightcode/cli

`knightcode` — a local-first, bring-your-own-key AI coding CLI for your terminal.

## Install

```bash
npm install -g @knightcode/cli
```

No prerequisites — the Bun runtime is bundled into the binary. The right
platform binary installs automatically as an optional dependency.

## Quick start

```bash
knightcode
```

On first run, set your OpenRouter API key from inside the app.

## Configuration

State lives in `~/.knightcode/` (sessions, settings, local SQLite database).

| Command / env var | Effect |
| ----------------- | ------ |
| `knightcode --version` | Print the installed version |
| `knightcode doctor` | Print diagnostics (config, database, API key, runtime) |
| `KNIGHTCODE_NO_UPDATE_CHECK=1` | Disable the background update check |

## Supported platforms

Linux (x64, arm64), macOS (x64, arm64), Windows (x64).
```

- [ ] **Step 2: Verify the README is included by the package `files` allowlist**

Run: `cd packages/cli; npm pack --dry-run 2>&1`
Expected: the file list includes `README.md` and `bin/knightcode`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/README.md
git commit -m "docs(release): @knightcode/cli package README"
```

---

## Task 9: Initial changeset for the first release

**Files:**
- Create: `.changeset/initial-release.md`

- [ ] **Step 1: Write the changeset**

`.changeset/initial-release.md`:

```markdown
---
"@knightcode/cli": minor
---

Initial public release: `knightcode` ships as a self-contained compiled binary
(no Bun required) distributed via platform-specific npm packages, with a headless
`--version` and `doctor`, embedded database migrations, and a non-blocking update
check.
```

(Only `@knightcode/cli` is listed; the fixed group bumps the five platform packages to the same version. Bumping `0.0.0` with a `minor` changeset yields `0.1.0`.)

- [ ] **Step 2: Verify Changesets sees it and computes 0.1.0**

Run: `bunx changeset status`
Expected: reports `@knightcode/cli` (and the fixed-group platform packages) bumping to `0.1.0`.

- [ ] **Step 3: Commit**

```bash
git add .changeset/initial-release.md
git commit -m "chore(release): initial changeset for v0.1.0"
```

---

## Task 10: Full-branch validation + holistic review

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole repo**

Run: `bun run check-types`
Expected: exit 0 across all packages.

- [ ] **Step 2: Run the CLI test suite**

Run: `cd packages/cli; bun test`
Expected: all pass, 0 fail.

- [ ] **Step 3: Re-run pack-test from clean binaries**

Run (PowerShell): `Remove-Item -Recurse -Force packages/cli-*/bin -ErrorAction SilentlyContinue; bun run scripts/pack-test.ts`
Expected: builds the current-platform binary, packs, installs, and prints `pack-test passed for <platform>`.

- [ ] **Step 4: Confirm no stale references to the old build output**

Run: `grep -rn "dist/" scripts/ packages/cli/package.json package.json` (ripgrep via the Grep tool)
Expected: no references tying the release path to `dist/` (the old per-platform `dist/<os>-<arch>` output is gone; any remaining `dist` mention is unrelated, e.g. a pre-existing ignore).

- [ ] **Step 5: Confirm the published file list is correct for one platform package**

Run: `cd packages/cli-win32-x64; npm pack --dry-run 2>&1` (after a build so `bin/` is populated)
Expected: the tarball contents include `bin/knightcode.exe` and `package.json` — proving decision #5 (root-gitignore) did not exclude the binary.

- [ ] **Step 6: Holistic review (manual)**

Re-read the diff for the whole branch with fresh eyes:
- Published `@knightcode/cli` has zero runtime `dependencies` (only `optionalDependencies`).
- Launcher is CommonJS, builtins only, handles the missing-binary case.
- `ci:publish` order is build → pack-test → publish (gate before publish).
- Changeset fixed group lists all six packages; `ignore` lists `@knightcode/shared`.
- No specs/plans staged for commit.

- [ ] **Step 7: Report readiness**

Summarize: tests, type-check, pack-test results; the one-time GitHub/npm setup the user still must do (NPM_TOKEN secret, Actions write permission + "allow PRs", install the changeset-bot app, create the npm `@knightcode` scope); and that the first real publish happens when the Version PR (opened after this branch merges to `main`) is merged.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
| ------------ | ---------- |
| §1 Build pipeline / binaries into package folders | Task 3 |
| §1 Migration embedding / version injection | Plan A (already done); unchanged |
| §2 Migration runner | Plan A (already done) |
| §3 Checksums | Deferred by spec — not in plan (intentional) |
| §4 Platform package stubs + `.gitignore` | Task 1 (gitignore via root — decision #5) |
| §4 Main package changes (private/version/files/optionalDeps/engines/shared/dotenv) | Task 4 (+ launcher dotenv removed in Task 2) |
| §4 require.resolve launcher | Task 2 |
| §5 `--version` + update check | Plan A (already done) |
| §6 `doctor` | Plan A (already done) |
| §7 GitHub Actions workflow | Task 7 (single-runner cross-compile — decision #1) |
| §7 pack-test | Task 5 (+ gate in `ci:publish`, Task 6) |
| §8 Changesets config + workflow | Task 6, Task 9 |
| §10 README | Task 8 |
| §11 Pre-publish checklist (one-time GH/npm setup) | Task 10 Step 7 (reported to user — human actions, not code) |

No spec requirement is left without a task or an explicit deferral.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases" — every step has concrete file contents or an exact command + expected output.

**3. Type/name consistency:** Package names `@knightcode/cli-<platform>-<arch>` are identical across the stubs (Task 1), launcher `require.resolve` (Task 2), `optionalDependencies` (Task 4), changeset `fixed` group (Task 6), and the changeset (Task 9). The launcher binary names (`knightcode` / `knightcode.exe`) match what `scripts/build.ts` writes (Task 3) and what `pack-test` resolves (Task 5). `ci:version`/`ci:publish` names match the workflow inputs (Task 6 ↔ Task 7).
