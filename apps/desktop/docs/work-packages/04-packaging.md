# WP04 — packaging (Phase D)

Status: implemented 2026-09-13. Open: the clean-machine run on the owner's
laptop (Task 5 Step 4); the macOS and Linux bundles are written, not run
Date: 2026-09-13
Revision: 2 — the owner's answers applied; implementation notes and results

Implement this plan task by task, in order. Each task carries its own check
cycle; do not start the next until the current one's checks pass and the
build is clean. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clean machine with no Bun, no Node, no npm and no CLI installs
the IDE, signs in, and completes an agent turn. Windows first and verified
here; macOS and Linux bundles written and reviewable, their run-time
evidence owed by whoever has the hardware.

**Architecture:** Nothing new is built. Zed already has three bundle
pipelines — `script/bundle-windows.ps1` into Inno Setup,
`script/bundle-mac` into a notarised `.dmg`, `script/bundle-linux` into a
tarball — and each assembles a payload directory before packaging it.
Phase D changes three things in each: what identity the payload carries
(names, icons, publisher, bundle id), what the payload contains (the
engine and its runtime assets, in an `engine/` directory beside the IDE
executable), and what it no longer contains (the Windows 11 shell
extension, the remote server, the auto-update helper). One line of Rust in
`crates/knightcode_engine` teaches `locate_binary` about that directory;
the rest is identity strings and bundle scripts.

**Tech Stack:** PowerShell 5.1 and Inno Setup 6 on Windows; bash,
`cargo bundle` and `notarytool` on macOS; bash and `envsubst` on Linux.
Icons are generated with Python 3.11 and Pillow 11.3 from the brand asset
already in this repository. Rust changes are one crate function and a set
of string constants, checked with `cargo test` and `cargo build -p zed`.

**Spec:** `apps/desktop/docs/architecture.md` — §7 Engine lifecycle
(what packaging must not break), §8 Fork surface, §9 Repository layout,
§10 Phase D, §12 Exclusions, §15 Stop condition. `repositories.md` §4 (how
the halves find each other) and §5 (where a change goes). WP03's
Exclusions list what it deferred here: icons, bundle identifiers,
installer metadata, the About dialog.

## Global Constraints

Copied from the Phase D handover, `AGENTS.md` and WP03. Every task's
requirements implicitly include this section.

- Never add a `Co-Authored-By` trailer, a session line, or a "Generated
  with" footer to a commit message or a PR body. Strip them if something
  adds them.
- Never commit unless asked. When asked: one commit per task, message
  format `{feat,fix,docs,chore}(<scope>): <message>`, root-cause reasoning
  in the body, staged by explicit path. Never `git add -A` or `git add .`
  — `apps/remote/` is someone else's untracked work. Never
  `git reset --hard`, `git checkout .`, `git stash`, `--no-verify`, or a
  force push.
- Committed text carries no trace of tooling or reference trees: no skill
  names, no assistant names. Cite Zed and OpenCode by their own paths.
- Do not run `bun run build:cli` or a full test suite unless asked. Task 0
  needs `bun run build:engine` once and says why; ask before running it.
- Never spend paid provider tokens in a test. The root `.env` is
  auto-loaded by Bun and carries real keys. Any engine started from a test
  uses the faux provider, a throwaway `KNIGHTCODE_CODING_AGENT_DIR` and
  `KNIGHTCODE_OFFLINE=1`, and creates no session. The one place real
  tokens are spent in this package is Task 5's agent turn, which is the
  exit condition and is run by hand.
- Windows is the primary platform. Absolute paths across every process
  boundary, forward slashes in JSON. Write source files with a file-write
  tool, not bash heredocs — they eat backslashes.
- The fork is additive. Every line changed in an upstream file is merged
  again on every Zed release. Before editing anything outside
  `crates/knightcode_*`, confirm it belongs in the fork-surface table in
  the fork's `README.md`, and add the row when it does. Nothing in
  `editor`, `project`, `workspace`, `terminal`, `git`, `vim` or `gpui`.
- No Rust reads `auth.json`, caches a credential, or links
  `credentials_provider`. The launch token is the only secret, and it
  travels in the environment only — never on argv. Packaging adds no
  secret: no certificate, keystore, Apple key or Azure credential is
  committed to either repository.
- Formatting: Rust is `cargo fmt` with the fork's `rustfmt.toml`;
  TypeScript is Prettier; Markdown is hand-wrapped at 80 columns. No
  emojis anywhere, including in the scripts this package edits — upstream
  `bundle-windows.ps1` prints three, and the lines we rewrite drop them.
- After Rust changes: `cargo build -p zed` clean, and `cargo test -p
  knightcode_engine -p knightcode_agent -p knightcode_models` green.
  Warnings in the three KnightCode crates are fixed, not ignored.
- Verify by running something. A packaging claim is worth what its
  evidence is worth: an installer that was run, a directory listing after
  it ran, a process that started. "It should work" is not a result.

---

## 0. Mandatory reading

Read completely before starting Task 0. Line numbers in the fork are as of
`6ff448240a` (the head of `main`, which `apps/desktop/ide` points at). Line
numbers in this repository are as of `c357f2c30`.

In this repository:

1. `apps/desktop/docs/architecture.md` — §7, §8, §9, §10 Phase D, §12,
   §14, §15.
2. `apps/desktop/docs/repositories.md` — all of it, twice. §4 is the
   contract packaging must not break; §5's table says where a change goes;
   §6 Gotchas is where Phase C's lost time went.
3. `apps/desktop/docs/work-packages/03-fork.md` — §1.1 (why the engine is
   spawned directly), §1.8 (the settings section and the binary lookup),
   Implementation notes lines 4899–5040, Validation results lines
   5194–5268 (what the running-IDE walk did and did not cover), Exclusions
   lines 5096–5125.
4. `AGENTS.md` at the repository root.
5. `scripts/build.ts` lines 16–75 (`copyRuntimeAssets`: what the compiled
   binary expects to find beside itself, and why), 77–90
   (`windowsMetadata`), 92–130 (the five targets; `--single` builds the
   host only, no flag builds all five), 165–196 (`--engine` writes
   `knightcode-engine[.exe]` into `packages/cli-<os>-<arch>/bin/`).
6. `packages/cli/src/config.ts` lines 424–436 (`getPackageDir`: in a
   compiled binary this is the directory of the executable), 440–510 (the
   theme, export-html, docs, examples, README and assets paths derived
   from it), 520–545 (`VERSION` and `APP_NAME` from the `package.json`
   beside the executable; absent, the version reads `0.0.0`).
7. `packages/cli/src/core/system-prompt.ts` lines 75–78 and 138–140 — the
   system prompt names the README, docs and examples paths absolutely. If
   those files do not ship beside the engine, the agent is told about
   directories that do not exist.

In the fork, paths relative to its root:

8. `script/bundle-windows.ps1` — whole file, 404 lines. The call sequence
   at 379–395 is the pipeline; `PrepareForBundle` (98) copies
   `crates/zed/resources/windows/*` into `inno/<arch>/`, which is the
   payload directory every later function adds to; `BuildZedAndItsFriends`
   (116) builds and renames `zed.exe` to `Zed.exe` at bundle time — the
   product's executable name is a copy destination, not a cargo bin name;
   `BuildRemoteServer` (138), `MakeAppx` (197) and
   `SignZedAndItsFriends` (216) are the three Phase D drops; `CollectFiles`
   (242) is the final layout; `BuildInstaller` (263) holds the per-channel
   identity block and hands it to Inno as `/d` definitions.
9. `crates/zed/resources/windows/zed.iss` — `[Setup]` 1–42 (publisher,
   support URLs, `DefaultDirName={autopf}\{#AppName}` with
   `PrivilegesRequired=lowest`, so the install directory is
   `%LOCALAPPDATA%\Programs\<AppName>`), `[Languages]` 44–46 (the licence
   page shows `script\terms\terms.rtf`), `[Files]` 67–81 (where the engine
   is added), `[Icons]` 83–85, `[Registry]` 1255–1262 (the PATH entry and
   the `zed` URI scheme), `[Code]` 1264–1421 (`GetInstallDir` and
   `GetAppMutex` switch behaviour while updating; `AddAppxPackage` and
   `RemoveAppxPackage` are the shell extension).
10. `crates/zed/resources/windows/sign.ps1` — whole file, 55 lines. Every
    variable is required and the script throws without them; it is called
    only when `CheckEnvironmentVariables` (65) has found all eight, and
    only under `$env:CI`.
11. `crates/windows_resources/src/windows_resources.rs` lines 42–50 (the
    channel-to-icon-and-product-name map compiled into the executable),
    80–106 (the `VERSIONINFO` block: `ProductName`, `CompanyName`,
    `LegalCopyright` — what Windows shows in file properties and the task
    manager).
12. `crates/paths/src/paths.rs` lines 14–18 — `APP_NAME`, with upstream's
    own note that a fork should change it, and 120–175 for what it
    derives: on Windows `%LOCALAPPDATA%\<APP_NAME>` for data and
    `%APPDATA%\<APP_NAME>` for config.
13. `crates/release_channel/src/lib.rs` lines 13–33 (the channel comes
    from `crates/zed/RELEASE_CHANNEL` at compile time, overridable by
    `ZED_RELEASE_CHANNEL` only in debug builds), 45–52 (`app_identifier`,
    which is the instance mutex's prefix), 201–204 (`poll_for_updates`),
    206–214 (`display_name`, already KnightCode's), 228–236 (`app_id`, the
    Wayland and X11 identity and the macOS bundle identifier).
14. `crates/auto_update/src/auto_update.rs` lines 262–300 (`init`: polling
    starts only when `poll_for_updates()` is true, and the settings
    observer is only installed inside that branch), 318–338 (`check`: the
    manual action says "Auto-updates disabled" when it is false), 340–358
    (`release_notes_url`: the stable and preview paths are built against
    the zed.dev server URL), 380–400 and 1285–1320 (the Windows installer
    directory and `Zed.exe` by name).
15. `crates/zed/src/zed/app_menus.rs` lines 69–76 — the application menu
    root, the About item and the Check for Updates item.
    `crates/zed/src/zed.rs` lines 1525–1540 (the About window's icon, one
    `include_bytes!` per channel, so all four icon files must exist for
    the crate to compile) and 1710–1725 (the window title).
16. `crates/cli/src/main.rs` lines 1270–1290 — how the PATH launcher finds
    the application: `../Zed.exe`, then two fallbacks, relative to its own
    executable.
17. `crates/zed/Cargo.toml` lines 1–10 (the package version, which becomes
    the installer's `RELEASE_VERSION` through `script/lib/workspace.ps1`),
    60–66 (the `zed` bin target), 288–318 (the four
    `package.metadata.bundle-<channel>` blocks: icon list, identifier,
    name, URL schemes — the macOS identity).
18. `script/bundle-mac` lines 85–118 (build, then `cargo bundle` with the
    channel's metadata block renamed into place, then the document icon),
    120–135 and 196–230 (signing and entitlements, all conditional on five
    environment variables), 340–356 (the two binaries copied into
    `Contents/MacOS/`).
19. `script/bundle-linux` lines 150–220 — the payload: the IDE at
    `libexec/zed-editor`, the launcher at `bin/zed`, bundled libraries,
    icons by channel, the `.desktop` file from `APP_ID`, and the tarball
    name.
20. `crates/knightcode_engine/src/environment.rs` lines 8–15 (`BINARY_NAME`
    and the three environment variable names), 82–106 (`locate_binary`:
    the setting, then the environment variable, then the sibling of the
    IDE executable; the error names the path it tried), 140–173 (its
    tests). `crates/knightcode_engine/src/engine.rs` lines 285–295 — the
    call site passes `current_exe().parent()`.
21. `README.md` — the fork-surface table, which every upstream file this
    package touches must be added to, and the "Pointing a development
    build at an engine" section, which Task 1 updates.

Decisions already taken by the owner, 2026-09-12, which this plan assumes:

- All three platforms are in scope. Windows is validated here; macOS and
  Linux are written but not run (§1.9).
- Ship unsigned for v1. No Authenticode certificate and no Azure Trusted
  Signing account exists (§1.4).
- The PATH launcher is `knightcode-ide`, not `knightcode`, which the CLI
  owns (§1.6).
- Ship as the `stable` channel with updates off (§1.3).

---

## 1. Design

Problem, trace, solution, per decision. Each rests on the lines read above
and, where marked, on probes run on 2026-09-12 whose observations the
checks in Tasks 1, 4 and 5 make repeatable.

### 1.1 The payload is a directory, and it sits beside the IDE executable

`locate_binary`'s third and last lookup is `knightcode-engine.exe` beside
the IDE executable (environment.rs 92). An installer that puts it anywhere
else produces an IDE that starts and then reports the path it tried. So
the engine goes next to `Zed.exe`, and the question is only whether the
engine is one file or several.

It is several. `scripts/build.ts` 16–75 copies a `package.json`, the
themes, the terminal assets, the export-html templates, the CLI's `docs/`,
this target's native prebuilds and `photon_rs_bg.wasm` into the same
directory as the binary, because in a compiled Bun binary `getPackageDir()`
is `dirname(process.execPath)` (config.ts 424–436). The system prompt then
names three of those paths absolutely (system-prompt.ts 138–140).

Verified (probe 1): the engine binary alone in an empty directory, with a
throwaway `KNIGHTCODE_CODING_AGENT_DIR` and `KNIGHTCODE_OFFLINE=1`,
printed `{"type":"listening","port":59872}`, answered `GET /health` with
`200 {"status":"ok"}`, answered `GET /v1/accounts` with the launch token
`200` (zero accounts, 47 login options) and `GET /v1/models` with
`200 {"models":[]}`, and wrote nothing to stderr. So the bare binary is
enough to start, authenticate and enumerate. What it cannot do without its
siblings is report its own version (`0.0.0`) or point the agent at docs
that exist.

Measured: the binary is 122.3 MB and everything else in
`packages/cli-win32-x64/bin` totals 5.3 MB, of which 1.8 MB is
`photon_rs_bg.wasm`. Shipping all of it costs 4 per cent of the payload.

Dumping those files into the install root is the wrong shape: `{app}` is
where `Zed.exe`, `conpty.dll` and the uninstaller live, and a `README.md`,
a `package.json` and a `docs/` tree there belong to a different product.

Solution: the payload is `<directory of the IDE executable>/engine/`,
holding `knightcode-engine[.exe]` and every sibling `scripts/build.ts`
produces except the CLI binary itself. `locate_binary` gains a fourth
candidate, tried after the bare sibling and before failing: `engine/` under
the same directory. One `or_else`, in our own crate, no merge surface. The
three platform layouts then agree:

| Platform | IDE executable | Engine |
| --- | --- | --- |
| Windows | `{app}\Zed.exe` (copied as the product name) | `{app}\engine\knightcode-engine.exe` |
| macOS | `KnightCode.app/Contents/MacOS/zed` | `.../Contents/MacOS/engine/knightcode-engine` |
| Linux | `knightcode.app/libexec/zed-editor` | `.../libexec/engine/knightcode-engine` |

The bare-sibling lookup stays, because a developer who drops one binary
beside a build should keep getting what WP03 gave them.

### 1.2 The identity is a dozen strings, and only two of them are ours

WP03 renamed what the user reads while the application runs: the release
channel display names, the agent's name, the window title through
`display_name()` (workspace.rs 6811 reads it at runtime). What is still
Zed's is what the *operating system* reads: the file on disk, the icon,
the publisher, the data directory, the bundle identifier, the shortcut.

Traced, with what each one drives:

| Where | Today | Drives |
| --- | --- | --- |
| `crates/paths/src/paths.rs:18` | `APP_NAME = "Zed"` | `%LOCALAPPDATA%\Zed`, `%APPDATA%\Zed`, the XDG directories. Upstream's own comment says a fork should change it |
| `crates/release_channel/src/lib.rs:228` | `app_id` `dev.zed.Zed*` | Wayland app id, X11 `WM_CLASS`, the macOS bundle identifier it must match |
| `crates/release_channel/src/lib.rs:45` | `app_identifier` `Zed-Editor-*` | the single-instance mutex, which the installer must name to detect a running app |
| `crates/windows_resources/.../windows_resources.rs:42–50, 96–98` | icon file, `ProductName`, `CompanyName`, `LegalCopyright` | file properties, the task manager, the executable's icon |
| `crates/zed/Cargo.toml:288–318` | `identifier`, `name`, `icon` per channel | the `.app` bundle's name and identity |
| `crates/zed/src/zed/app_menus.rs:71,74` | menu root `"Zed"`, `"About Zed"` | the application menu |
| `crates/zed/src/zed.rs:1717` | `"About Zed"` | the About window's title |
| `crates/cli/src/main.rs:1279` | `"../Zed.exe"` | how the PATH launcher finds the app |
| `crates/zed/resources/*.png`, `windows/*.ico`, `Document.icns` | Zed's mark | every icon the OS shows |
| `script/bundle-*` identity blocks | `Zed`, `ZedIndustries.Zed`, `dev.zed.Zed` | shortcut, AppUserModelID, `.desktop` id |
| `zed.iss:5–8` | publisher `Zed Industries`, URLs `zed.dev` | Add/Remove Programs |

Note what is *not* on this list: the `zed` cargo bin target, and the
`zed`/`zed-editor` file names inside the macOS and Linux payloads. Both
bundle scripts already rename at copy time (`bundle-windows.ps1` 121,
`bundle-linux` 157), so the product's executable name on Windows is a
destination string, free of Rust. On macOS `cargo bundle` takes the
executable name from the bin target, so `Contents/MacOS/zed` stays `zed`;
renaming it means post-processing `CFBundleExecutable` and is not worth a
merge conflict in v1 (§1.9, limitations).

`app_identifier()` is `Zed-Editor-Stable` while `bundle-windows.ps1` 273
passes `Zed-Stable-Instance-Mutex`, so upstream's installer does not
actually match the mutex its own comment says it must. Ours will match.

Solution: change those strings, in one task, and add each upstream file to
the fork-surface table. `paths::APP_NAME` moves the data directory, so a
developer's existing `%LOCALAPPDATA%\Zed` dev profile is left behind; that
is the point of changing it, and `--user-data-dir` still overrides.

### 1.3 Updates point at zed.dev, so they are turned off at the channel

Phase D ships `stable`, and `poll_for_updates()` is true for every channel
but `Dev` (release_channel 201–204). The updater then polls the client's
server URL, which is zed.dev unless `ZED_SERVER_URL` says otherwise
(client.rs 63–64, 119), downloads what it finds, and on Windows runs it
through `auto_update_helper` against files it identifies as `Zed.exe`
(auto_update.rs 380–400, updater.rs 175–193). An installed KnightCode that
polled would be offered Zed, and a successful update would replace the
product with a different one.

There is no KnightCode release feed to point it at; building one is its
own phase.

Solution: `poll_for_updates()` returns `false` for every channel. That one
line disables the background poll, the settings observer (auto_update.rs
284–298 sits inside the branch), and the manual Check for Updates action,
which then falls through to its existing "Auto-updates disabled" prompt
(318–338) — so the menu item is removed as well. `assets/settings/
default.json:1665` sets `"auto_update": false` too, so a user reading their
settings sees the truth. Consequences: `auto_update_helper.exe` is dead
weight and is not bundled (§1.7), and shipping a fix means shipping an
installer.

### 1.4 The Windows 11 shell extension is dropped for v1

`MakeAppx` (bundle-windows.ps1 197) packs
`crates/explorer_command_injector/AppxManifest.xml`, whose `Identity` is
`Name="ZedIndustries.Zed"` with `Publisher="CN=Zed Industries Inc, ...";`
the installer then adds and removes it by the full package name
`ZedIndustries.Zed_1.0.0.0_neutral__japxn1gcva8rg`, whose last field is a
hash of that publisher string. Shipping it unchanged would have KnightCode
install a package that claims to be Zed Industries'. Changing the publisher
changes the hash, so the four hard-coded full names in `bundle-windows.ps1`
and the `[UninstallRun]` line in `zed.iss` all have to be recomputed. And
the owner's answer is that no signing certificate exists, while
`Add-AppxPackage` requires a signature it trusts.

Solution: drop it for v1. `MakeAppx` and the appx `[Files]` and
`[UninstallRun]` lines go; the `addcontextmenufiles` task stays but its
registry entries lose their `Check: not IsWindows11OrLater` guard, which is
the classic shell verb Windows 11 shows under "Show more options". The
limitation is recorded: "Open with KnightCode" is one click deeper on
Windows 11 than Zed's is. It comes back when there is a certificate.

### 1.5 The installer's licence page shows the wrong licence

`zed.iss:44–46` points both language entries at `script\terms\terms.rtf`,
which is Zed's Terms of Service ("Last Updated: March 2, 2026", welcoming
the reader to Zed). An installer for our product that asks the user to
accept Zed's terms is wrong on its face, and the file is generated from
`legal/terms.md` by a script that shells out to pandoc.

Solution: the licence page shows the GPL, which is the licence the IDE
actually ships under (architecture §8). `PrepareForBundle` copies
`LICENSE-GPL` into the payload as `license.txt`; Inno accepts a plain-text
`LicenseFile`. `legal/` and `script/terms/` are left untouched so the merge
stays quiet.

### 1.6 The PATH launcher cannot be called `knightcode`

Zed's `cli` crate builds the small launcher that the installer puts on
PATH: `CollectFiles` (242) moves `cli.exe` to `bin\zed.exe`, and the
`addtopath` task adds `{app}\bin`. Our CLI already owns `knightcode` on
PATH, installed by npm. Two executables with one name on one PATH resolve
by order, silently, and the loser is whichever the user needed.

Solution: the launcher is `knightcode-ide[.exe]`. It is a copy destination
in all three bundle scripts, so the only code change is the list of
relative locations it searches for the application
(`crates/cli/src/main.rs:1279`), which must learn the product's executable
name. The Linux script's `bin/zed` and the `.desktop` file's `Exec` line
change with it.

### 1.7 Three upstream payload members are not built

- **`remote_server`** (bundle-windows.ps1 138, bundle-linux 94). It is not
  installed by the installer at all; both scripts build it only to publish
  a separate archive for SSH remoting, which has no release feed here. It
  is a second full release build of a large crate. Dropped; SSH remoting
  falls back to Zed's "no server available" path.
- **`auto_update_helper`** (bundle-windows.ps1 120). Dead once §1.3 turns
  updates off, and it is the one binary that renames files by the literal
  name `Zed.exe` (updater.rs 175–193), so keeping it would mean keeping
  its names in step for nothing.
- **The Sentry symbol upload** (bundle-windows.ps1 170, guarded by
  `$env:CI`). It uploads to Zed's Sentry organisation (`-o zed-dev`).
  Dropped rather than repointed; crash reporting is not in Phase D's scope
  and `architecture.md` §12 forbids telemetry the CLI does not send.

`explorer_command_injector` follows §1.4. Everything else upstream
assembles — conpty, OpenConsole, the AMD AGS library, the licence
manifest, the debug archive — stays, because each is a runtime dependency
of the editor or a build artefact the release wants.

### 1.8 A release build needs disk this machine does not have

Measured: `C:` has 20.4 GB free of 930 GB, and
`C:\Users\Raghav\Desktop\knightcode-ide\target` is 119.3 GB, all of it the
debug profile. The bundle builds `--release --target x86_64-pc-windows-msvc`,
which is a different directory from `target/debug` and shares nothing with
it, under `lto = "thin"` and `codegen-units = 1` (root `Cargo.toml`
1106–1112). Expect tens of gigabytes and hours, from cold.

This is a prerequisite, not a design decision, and it is the owner's call
how to satisfy it: delete `target/debug` (a later debug build costs an
hour), or delete the submodule checkout's own target directory if one has
grown, or add a disk. Task 0 asks before deleting anything and does not
proceed until there is headroom; `script/clear-target-dir-if-larger-than.ps1`
is upstream's own tool for this.

### 1.9 macOS and Linux cannot be validated here, and the plan says so

Tasks 6 and 7 write the macOS and Linux halves: the same identity strings,
the same `engine/` payload, the same drops. Neither can be run on this
machine, and a bundle script that has never been run is a draft. `cargo
bundle`'s behaviour, `notarytool`, the Linux library-bundling `ldd` walk
and `envsubst` are all unobservable from Windows.

Solution: those tasks are complete when the scripts are written, reviewed
against the upstream flow they modify, and the identity greps pass — and
they are marked *unverified* in the Validation section, with the exact
commands and the exact evidence each needs, so whoever has a Mac or a
Linux box can close them without rereading this plan. No claim that either
bundle works appears anywhere until somebody has run it. macOS additionally
has no Apple Developer account on record: unsigned and unnotarised, macOS
Gatekeeper blocks the `.dmg` for anyone who did not build it, which is a
question for the owner, not a thing Task 6 can fix.

Known limitations to record: `Contents/MacOS/zed` keeps its name inside
the bundle (§1.2); Linux ships no `remote_server` (§1.7).

### 1.10 Amendments to architecture.md and repositories.md

- §9 lists `apps/desktop/packaging/` for "installers, signing,
  notarisation" and `apps/desktop/scripts/` for "bundle the engine into the
  app payload". Neither exists, and `repositories.md` §5 puts the installer
  in the fork, which is where Zed's three bundle scripts already are and
  the only tree that can build the IDE. §9 becomes: packaging lives in the
  fork's `script/`; this repository keeps `apps/desktop/scripts/` for the
  one thing that needs the brand source, icon generation.
- §10 Phase D says "MSI or NSIS". It is Inno Setup, because that is the
  pipeline the fork inherits; the sentence is corrected.
- §14 gains the two limitations from §1.9 and the Windows 11 context menu
  from §1.4.
- `repositories.md` §4 gains the `engine/` directory in the runtime
  diagram, and §6 gains the disk-space gotcha.

---

## File structure

The fork, `KnightCodeAI/knightcode-ide`, paths relative to its root.
Modified:

```text
crates/knightcode_engine/src/environment.rs   the engine/ candidate (Task 1)
crates/paths/src/paths.rs                     APP_NAME (Task 2)
crates/release_channel/src/lib.rs             app_id, app_identifier, poll_for_updates (Task 2)
crates/zed/RELEASE_CHANNEL                    dev -> stable (Task 2)
crates/windows_resources/src/windows_resources.rs  product, company, copyright (Task 2)
crates/zed/Cargo.toml                         four bundle metadata blocks (Task 2)
crates/zed/src/zed/app_menus.rs               menu root, About, Check for Updates (Task 2)
crates/zed/src/zed.rs                         the About window title (Task 2)
crates/cli/src/main.rs                        the executable it looks for (Task 2)
crates/agent_ui/src/conversation_view.rs      the composer placeholder (Task 2)
assets/settings/default.json                  auto_update (Task 2)
crates/zed/resources/*.png                    app icons (Task 3)
crates/zed/resources/*.icns                   macOS icons (Task 3)
crates/zed/resources/windows/*.ico            Windows icons (Task 3)
script/bundle-windows.ps1                     payload, identity, drops (Task 4)
crates/zed/resources/windows/zed.iss          files, publisher, licence, scheme (Task 4)
script/bundle-mac                             payload, identity (Task 6)
script/bundle-linux                           payload, identity (Task 7)
crates/zed/resources/zed.desktop.in           comment, keywords, URL scheme (Task 7)
crates/zed/src/main.rs                        palette filter; the APP_NAME assert (Task 2)
crates/zed/resources/info/*.plist             the name in macOS prompts and Finder (Task 2)
crates/zed/resources/windows/zed.sh           the launcher it calls (Task 4)
script/install.sh, install-linux, uninstall.sh  names and paths (Task 7)
README.md                                     fork surface, payload layout (Tasks 1-8)
```

This repository:

```text
apps/desktop/scripts/generate-icons.py        brand asset -> every icon format (Task 3)
apps/desktop/docs/architecture.md             §1.10 amendments (Task 8)
apps/desktop/docs/repositories.md             §1.10 amendments (Task 8)
apps/desktop/docs/work-packages/04-packaging.md  this plan, with results (Task 8)
apps/desktop/ide                              the submodule pointer (Tasks 1-8)
```

No new crate, no new module, no packaging code in TypeScript. Budget: under
150 changed lines of Rust and script in the fork, plus about 120 lines of
Python for the icons. If a task runs well past that, stop and reconsider
before continuing.

---

## Task 0: Prerequisites

Nothing in this task changes a tracked file. It ends with a machine that
can build an installer and a written record of what it took.

**Interfaces:**
- Consumes: `winget`, `rustup`, the VS Build Tools, `bun`.
- Produces: Inno Setup on the machine, disk headroom, a current engine
  binary, and a fork whose base is not stale.

- [ ] **Step 1: Re-run the upstream merge**

The handover asks for this before packaging, so Phase D is not built on a
base that has drifted. On a scratch branch in the fork, so nothing is
committed to `main`:

```powershell
git -C C:\Users\Raghav\Desktop\knightcode-ide fetch upstream
git -C C:\Users\Raghav\Desktop\knightcode-ide switch -c scratch/merge-check
git -C C:\Users\Raghav\Desktop\knightcode-ide merge upstream/main
```

Record the upstream head and the result. Conflicts are expected only in the
fork-surface table's files; anything else is a defect and stops the task.
Then leave `main` as it was: if the merge is clean and wanted, ask the
owner before taking it onto `main`; otherwise abandon the scratch branch
with `git switch main` and `git branch -D scratch/merge-check`.

- [ ] **Step 2: Inno Setup**

`ISCC.exe` is not on this machine; `bundle-windows.ps1` 331 expects it at
`C:\Program Files (x86)\Inno Setup 6\ISCC.exe`. Ask the owner before
installing, then:

```powershell
winget install --exact --id JRSoftware.InnoSetup
Test-Path "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
```

Paste the version ISCC prints. `makeAppx.exe` is present at the SDK path
the script hard-codes, but §1.4 drops its only caller.

- [ ] **Step 3: Disk**

Report the current numbers (`Get-PSDrive C`, and the size of both fork
checkouts' `target` directories), state how much a release build needs, and
ask the owner which directory to free. Delete nothing without that answer;
`git clean` is forbidden and `target` may hold another session's work.

- [ ] **Step 4: The engine binary**

`packages/cli-win32-x64/bin/knightcode-engine.exe` was built 2026-09-11
18:21, which is before `7c7a39c63` taught `/v1/models` to report the model
the user chose — the fix that made the IDE stop guessing which account to
spend. The installer must not ship a binary that predates it. Ask the
owner, then, in this repository:

```powershell
bun run build:engine
```

That writes the host target only. macOS and Linux payloads need the other
four, which the same script cross-compiles with no `--single`; Tasks 6 and
7 say when. Record the new size and timestamp, and confirm the binary still
prints its port line and exits on stdin EOF (WP03's Task 0 test covers
this: `cd packages/cli && bun x vitest --run test/engine/engine-entry.test.ts`).

- [ ] **Step 5: Report**

One short report: upstream head and merge result, ISCC version, the disk
decision, the engine's new timestamp, and anything the owner must do before
Task 5 (a second Windows user account, if that is how the clean-machine
check will be run).

---

## Task 1: The engine lives in `engine/`

**Files (fork):**
- Modify: `crates/knightcode_engine/src/environment.rs`, `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `locate_binary` finds `<exe dir>/engine/knightcode-engine[.exe]`.

- [ ] **Step 1: Write the failing test**

In `environment.rs`'s test module, beside
`the_binary_is_found_by_setting_then_env_then_sibling_and_absence_names_the_path`
(environment.rs 147):

```rust
    #[test]
    fn the_binary_is_found_in_the_engine_directory_beside_the_executable() {
        let dir = tempfile::tempdir().unwrap();
        let engine_dir = dir.path().join("engine");
        std::fs::create_dir(&engine_dir).unwrap();
        let present = engine_dir.join(BINARY_NAME);
        std::fs::write(&present, b"").unwrap();

        assert_eq!(locate_binary(None, None, Some(dir.path())).unwrap(), present);
    }
```

And extend the existing absence test so the error still names a path the
installer would have used. Run `cargo test -p knightcode_engine` and paste
the failure.

- [ ] **Step 2: Make it pass**

One candidate, after the bare sibling:

```rust
    let candidate = setting
        .map(Path::to_path_buf)
        .or_else(|| env.map(Path::to_path_buf))
        .or_else(|| {
            // The installers put the engine and its runtime assets in their own
            // directory beside the IDE executable; a development build drops the
            // bare binary there instead.
            exe_dir
                .map(|dir| dir.join(BINARY_NAME))
                .filter(|path| path.is_file())
        })
        .or_else(|| exe_dir.map(|dir| dir.join("engine").join(BINARY_NAME)));
```

Note the `filter`: without it the bare sibling wins as a candidate even
when it does not exist, and the packaged path is never tried. That is the
whole bug this step exists to avoid, and the test above fails without it.

- [ ] **Step 3: Check**

```powershell
cargo test -p knightcode_engine
cargo build -p zed
```

Both from `C:\Users\Raghav\Desktop\knightcode-ide`, with the CMake
directory on `PATH` (`repositories.md` §5). Paste the test summary.

- [ ] **Step 4: Record it**

The fork's `README.md` "Pointing a development build at an engine" section
gains the fourth lookup and the installed layout, so the next person does
not have to read `environment.rs` to learn where the installer puts things.

- [ ] **Step 5: Commit**

```bash
git add crates/knightcode_engine/src/environment.rs README.md
git commit -m "feat(knightcode_engine): find the engine in its own directory beside the IDE"
```

---

## Task 2: Identity

**Files (fork):** the eleven listed in §1.2's table, plus
`assets/settings/default.json` and `crates/agent_ui/src/conversation_view.rs`.

**Interfaces:**
- Consumes: nothing.
- Produces: an application the operating system knows as KnightCode, with
  its own data directory, its own instance mutex, and no update path.

Every string below is one line. Nothing in this task changes behaviour
beyond names, the data directory and the update poll.

- [ ] **Step 1: The names**

```text
crates/paths/src/paths.rs:18            APP_NAME = "KnightCode"
crates/release_channel/src/lib.rs:45-52 app_identifier -> "KnightCode-Dev" ... "KnightCode-Stable"
crates/release_channel/src/lib.rs:228   app_id -> "dev.knightcode.KnightCode[-Channel]"
crates/zed/src/zed/app_menus.rs:71      name: "KnightCode".into()
crates/zed/src/zed/app_menus.rs:74      MenuItem::action("About KnightCode", ...)
crates/zed/src/zed.rs:1717              title: Some("About KnightCode".into())
crates/cli/src/main.rs:1279             ["../KnightCode.exe", "../lib/knightcode/knightcode-ide", "./zed.exe"]
crates/zed/Cargo.toml [package]         version = "0.1.0" (owner, 2026-09-13)
```

`app_id` must match the macOS bundle identifier (Step 3) and the Linux
`.desktop` file name (Task 7); pick `dev.knightcode.KnightCode` and keep
all three in step. Its doc comment says so; leave the comment.

- [ ] **Step 2: The Windows resource block**

`crates/windows_resources/src/windows_resources.rs` 42–50 maps the channel
to an icon file and a product name; 96–98 carries the company and the
copyright. Product names become KnightCode's, `CompanyName` becomes
`KnightCodeAI`, `LegalCopyright` becomes `Copyright 2026 KnightCodeAI`.
Icon file names are unchanged — Task 3 replaces the files, not the names.

- [ ] **Step 3: The macOS bundle metadata**

`crates/zed/Cargo.toml` 288–318, four blocks: `identifier` to
`dev.knightcode.KnightCode[-Channel]`, `name` to `KnightCode[ Channel]`,
`osx_url_schemes` to `["knightcode"]`. `icon` keeps its file names.

- [ ] **Step 4: The channel and the updates**

```text
crates/zed/RELEASE_CHANNEL                  stable
crates/release_channel/src/lib.rs:201-204   poll_for_updates -> false, with the reason in a comment
crates/zed/src/zed/app_menus.rs:75          remove the Check for Updates item
assets/settings/default.json:1665           "auto_update": false
```

The comment on `poll_for_updates` states the fact, not the intention: the
update endpoint belongs to another product and there is no KnightCode feed
yet.

- [ ] **Step 5: The composer placeholder**

`crates/agent_ui/src/conversation_view.rs` 3334–3348, `placeholder_text`,
builds "Message the {agent}" from the agent id, which reads "Message the KnightCode". The
handover asks for this line here. Change the template for our id only, so
external agents keep upstream's wording, and add the file to the
fork-surface table — WP03 §1.4 had left it unspent.

- [ ] **Step 6: Check**

```powershell
cargo build -p zed
cargo test -p settings
cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models
```

`cargo test -p settings` parses `default.json`; WP03 learned the hard way
that a default the app cannot parse is a startup panic, not a test failure.
Then grep for what is left:

```powershell
rg -n '"Zed"|Zed Industries|dev\.zed\.' crates/zed crates/paths crates/release_channel crates/windows_resources crates/cli
```

Expected: test fixtures, `crates/zed/src/main.rs`'s upstream comments, and
nothing the user or the OS reads. Record every remaining hit with its
reason, the way WP03's Task 7 Step 4 did.

- [ ] **Step 7: Run it**

`cargo run -p zed` with `--user-data-dir` unset, once: confirm the data
directory it creates is `%LOCALAPPDATA%\KnightCode`, the window title says
KnightCode, the application menu's root and About item say KnightCode, and
Check for Updates is gone from the menu and from the command palette.
Paste the directory listing.

- [ ] **Step 8: Commit**

```bash
git add crates/paths/src/paths.rs crates/release_channel/src/lib.rs crates/zed/RELEASE_CHANNEL crates/windows_resources/src/windows_resources.rs crates/zed/Cargo.toml crates/zed/src/zed/app_menus.rs crates/zed/src/zed.rs crates/cli/src/main.rs crates/agent_ui/src/conversation_view.rs assets/settings/default.json README.md Cargo.lock
git commit -m "feat(zed): carry KnightCode's identity to the operating system"
```

---

## Task 3: Icons

**Files:** `apps/desktop/scripts/generate-icons.py` (this repository, new);
`crates/zed/resources/*.png`, `crates/zed/resources/*.icns`,
`crates/zed/resources/windows/*.ico` (the fork, replaced).

**Interfaces:**
- Consumes: `apps/web/public/knightcode-icon.png`, 1024x1024, the brand
  asset this repository already ships.
- Produces: every icon file the three bundles and the About window need.

The About window compiles one `include_bytes!` per channel (zed.rs
1525–1540), so all four PNG variants must exist whatever we ship.

- [ ] **Step 1: The generator**

`apps/desktop/scripts/generate-icons.py`, Python 3.11 with Pillow 11.3
(both present; check with `python -c "import PIL; print(PIL.__version__)"`).
It reads the brand asset and writes:

```text
crates/zed/resources/app-icon.png            512x512
crates/zed/resources/app-icon@2x.png         1024x1024
  and -dev, -nightly, -preview variants of both
crates/zed/resources/windows/app-icon.ico    16,24,32,48,64,128,256
  and -dev, -nightly, -preview
crates/zed/resources/app-icon.icns           16..1024, PNG entries
crates/zed/resources/Document.icns           the same, as upstream's placeholder
```

The four channels share one mark in v1 — we ship `stable` and the other
three exist only to compile. The script takes the fork's path as its one
argument so it works against either checkout, and prints what it wrote.
Pillow writes `.ico` and `.png` directly; `.icns` is a TOC header followed
by PNG entries keyed `ic07`–`ic14`, about forty lines, no macOS tooling
needed.

- [ ] **Step 2: Read them back**

The check is the same script's `--verify` pass: reopen every file it wrote
with Pillow, assert the sizes it claims, and for the `.icns` assert the
entry count and that each entry decodes. Paste the output. An icon that
Windows silently refuses is the classic packaging failure, so also open the
`.ico` in Explorer's properties dialog once and say what it showed.

- [ ] **Step 3: Build and look**

`cargo build -p zed` (the resource is compiled in by
`windows_resources::compile`), then run it: the taskbar button, the window
icon and the About window's image are the new mark. Say so, having looked.

- [ ] **Step 4: Commit**

Two commits, one per repository: the generator here, the generated files in
the fork.

```bash
git add apps/desktop/scripts/generate-icons.py
git commit -m "feat(desktop): generate the IDE's icons from the brand asset"
```

```bash
git add crates/zed/resources
git commit -m "feat(zed): replace the application icons"
```

---

## Task 4: The Windows installer

**Files (fork):** `script/bundle-windows.ps1`,
`crates/zed/resources/windows/zed.iss`.

**Interfaces:**
- Consumes: `KNIGHTCODE_ENGINE_DIR`, an absolute path to a directory holding
  a built `knightcode-engine.exe` and its runtime assets.
- Produces: `target/KnightCode-x86_64.exe`, an installer that lays down the
  IDE, the engine and the PATH launcher.

- [ ] **Step 1: Stage the engine**

A new function in `bundle-windows.ps1`, called after `PrepareForBundle`:

```powershell
function StageEngine {
    $source = $env:KNIGHTCODE_ENGINE_DIR
    if ([string]::IsNullOrWhiteSpace($source)) {
        throw "KNIGHTCODE_ENGINE_DIR is not set. It must be an absolute path to a directory containing knightcode-engine.exe and the runtime assets `bun run build:engine` writes beside it (packages/cli-win32-x64/bin in the KnightCode repository)."
    }
    $engineExe = Join-Path $source "knightcode-engine.exe"
    if (-not (Test-Path $engineExe)) {
        throw "knightcode-engine.exe was not found in $source. Build it with 'bun run build:engine'."
    }
    $dest = Join-Path $innoDir "engine"
    New-Item -Path $dest -ItemType Directory -Force | Out-Null
    # Everything the engine binary expects beside itself: package.json (its
    # version), theme, assets, export-html, docs, native prebuilds and the
    # photon wasm. The CLI binary is the one thing in that directory the IDE
    # does not ship.
    Copy-Item -Path (Join-Path $source "*") -Destination $dest -Recurse -Force -Exclude "knightcode.exe"
    Write-Output "Staged engine from $source"
}
```

The engine is not signed and not stripped; it is a Bun binary and neither
applies.

- [ ] **Step 2: The drops**

Remove the calls to `BuildRemoteServer`, `MakeAppx` and
`SignZedAndItsFriends` from the sequence at 384–395, and the functions with
them; drop `auto_update_helper` and `explorer_command_injector` from
`BuildZedAndItsFriends` and their moves from `CollectFiles`; drop
`UploadToSentry`. `ZipZedAndItsFriendsDebug` keeps only the PDBs that are
still built. `CheckEnvironmentVariables` loses the eight signing variables
and keeps the three required ones; `sign.ps1` stays in the tree, unused, so
the day a certificate exists is a one-function change. Say in a comment,
at each drop, why — a future reader must not have to guess whether it was
deliberate.

- [ ] **Step 3: The identity block**

`BuildInstaller` 263–330, the `stable` arm (the other three follow it):

```powershell
            $appId = "{{<a fresh GUID, generated once, recorded here>}"
            $appIconName = "app-icon"
            $appName = "KnightCode"
            $appDisplayName = "KnightCode"
            $appSetupName = "KnightCode-$Architecture"
            # Matches release_channel::app_identifier()'s mutex prefix.
            $appMutex = "KnightCode-Stable-Instance-Mutex"
            $appExeName = "KnightCode"
            $regValueName = "KnightCode"
            $appUserId = "KnightCodeAI.KnightCode"
            $appShellNameShort = "K&nightCode"
```

`$appId` is Inno's upgrade key: a fresh GUID per channel, generated once
with `[guid]::NewGuid()` and written into the script literally. Reusing
Zed's would make our installer upgrade a user's Zed. `$appAppxFullName`
goes with §1.4.

`BuildZedAndItsFriends` copies `zed.exe` to `$innoDir\KnightCode.exe` and
`cli.exe` to `$innoDir\knightcode-ide.exe`; `CollectFiles` moves the
latter to `bin\knightcode-ide.exe` and `zed.sh` to `bin\knightcode-ide`
(the WSL shim, whose body also names the executable).

- [ ] **Step 4: The licence**

`PrepareForBundle` copies `LICENSE-GPL` into the payload as `license.txt`;
`zed.iss` 44–46 points both languages at `{#ResourcesDir}\license.txt`.

- [ ] **Step 5: `zed.iss`**

```text
[Setup]      AppPublisher=KnightCodeAI; the three URLs -> https://knightcode.dev
[Files]      + Source: "{#ResourcesDir}\engine\*"; DestDir: "{code:GetInstallDir}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs
[Files]      - the appx line (§1.4)
[UninstallRun] - the Remove-AppxPackage line
[UninstallDelete] + Type: filesandordirs; Name: "{app}\engine"
[Registry]   the zed URI scheme -> knightcode, pointing at {#AppExeName}.exe
[Registry]   the context-menu entries lose "Check: not IsWindows11OrLater"
[Code]       AddAppxPackage/RemoveAppxPackage and their Before/AfterInstall hooks
```

`{code:GetInstallDir}` rather than `{app}`, so the engine follows the IDE
into `{app}\install` if the update path is ever revived. The file
associations (1100-odd lines) change only through `{#RegValueName}`, which
the definitions already carry.

- [ ] **Step 6: The check**

There is no unit test for an installer. The check is a compile of the
script without a build, which Inno will do on its own:

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /O<scratch> `
    /dAppId=... /dAppIconName=app-icon /dOutputDir=<scratch> ... `
    crates\zed\resources\windows\zed.iss
```

against a payload directory hand-populated with stub files of the right
names. Expected: exit 0 and a `.exe` in the scratch directory. This catches
a mistyped section, a missing definition and a source path that does not
exist, which is most of what Step 5 can get wrong, without waiting on a
release build. Paste ISCC's summary.

- [ ] **Step 7: Commit**

```bash
git add script/bundle-windows.ps1 crates/zed/resources/windows/zed.iss README.md
git commit -m "feat(packaging): build a KnightCode installer with the engine in its payload"
```

---

## Task 5: Build it, install it, use it

This is Phase D's exit condition. It spends real tokens on the owner's
accounts, by design and only here.

- [ ] **Step 1: Build**

With the disk decision from Task 0 applied:

```powershell
$env:KNIGHTCODE_ENGINE_DIR = "C:/Users/Raghav/Desktop/knightcode/packages/cli-win32-x64/bin"
.\script\bundle-windows.ps1
```

Record what it produced and how long it took. A failure here is a defect in
Task 4, not a reason to patch around the build.

- [ ] **Step 2: Read the payload before installing it**

List `inno/x86_64/` and the installer's size. Confirm: `KnightCode.exe`,
`engine\knightcode-engine.exe` with its assets, `bin\knightcode-ide.exe`,
no `auto_update_helper.exe`, no appx, no `remote_server`.

- [ ] **Step 3: Install**

Run the installer as the owner would. Then, before starting anything:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Programs\KnightCode" -Recurse -Depth 1 | Select-Object FullName, Length
```

Confirm the engine landed where `locate_binary` looks, and that Add/Remove
Programs shows KnightCode, KnightCodeAI, and the version.

- [ ] **Step 4: The clean-machine run**

The exit condition is a machine with no Bun, no Node, no npm and no CLI.
This machine has all four, so the run happens on the owner's laptop
(answered 2026-09-13): no `~/.knightcode`, no Bun or Node on PATH, and no
`KNIGHTCODE_ENGINE_PATH` in the environment. The installer is unsigned, so
SmartScreen warns ("More info", then "Run anyway"), and if Smart App Control
is on it blocks the installer outright; say which happened. Then, on the
laptop:

- launch from the Start menu; the engine starts (check the process tree:
  `KnightCode.exe` with an `engine\knightcode-engine.exe` child, spawned
  directly, no shell, no token on the command line);
- the agent panel offers sign-in, because that profile has no credential —
  the empty state WP03 could not exercise;
- sign in through the panel's OAuth button, in the browser, and complete
  one agent turn;
- Cmd+K in a buffer, Cmd+K in the terminal, Generate Commit Message, and
  one Tab prediction, all on that one sign-in;
- quit; both processes are gone within 8 seconds;
- uninstall; `%LOCALAPPDATA%\Programs\KnightCode` is gone and the PATH
  entry with it.

Record each observation with what was seen, not what was expected. This is
also where WP03's deferred model-surface walk gets closed.

- [ ] **Step 5: Report**

The Validation section's Windows results, written from the notes above.

---

## Task 6: The macOS bundle

**Files (fork):** `script/bundle-mac`.

Unverified by construction (§1.9). Write it, review it against the flow it
modifies, and leave the evidence owed.

- [ ] **Step 1: Stage the engine** into `${app_path}/Contents/MacOS/engine`,
  from `KNIGHTCODE_ENGINE_DIR` (default `packages/cli-darwin-<arch>/bin`
  in a sibling checkout), excluding the CLI binary. It must be staged
  *before* the codesign block at 196–230, or a later signature of the
  bundle will not cover it.
- [ ] **Step 2: Identity** — the `.app` name and the `.dmg` name follow
  `$channel`; the bundle identifier comes from Task 2's `Cargo.toml`
  blocks; `crates/zed/resources/zed.entitlements` keeps its file name and
  content (renaming it is three call sites for nothing).
- [ ] **Step 3: Signing** — the five-variable guard already skips signing
  and notarisation when they are absent, which is today's state. Leave the
  block; do not weaken the guard. Add one line to the skip message naming
  what an unsigned bundle means for the user (Gatekeeper refuses it).
- [ ] **Step 4: The engine binaries for macOS** are cross-compiled from
  anywhere: `bun run scripts/build.ts --engine --target=darwin-arm64` (and
  `darwin-x64`). Record the command in the fork's README; do not run a
  five-target build without asking.
- [ ] **Step 5: Review, do not claim.** State plainly in the commit body
  and in Validation that this script has not been run.

---

## Task 7: The Linux bundle

**Files (fork):** `script/bundle-linux`, `crates/zed/resources/zed.desktop.in`.

Unverified by construction (§1.9).

- [ ] **Step 1: Stage the engine** into `${zed_dir}/libexec/engine`, beside
  `zed-editor`, from `KNIGHTCODE_ENGINE_DIR` (default
  `packages/cli-linux-<arch>/bin`).
- [ ] **Step 2: Identity** — `${zed_dir}` becomes `knightcode.app`; the
  launcher at `bin/zed` becomes `bin/knightcode-ide`; `APP_ID` becomes
  `dev.knightcode.KnightCode[-Channel]`, matching `release_channel::app_id`
  or the desktop environment will not pair the window with its icon;
  `APP_CLI` and `APP_ICON` follow; the icons copied into
  `share/icons/hicolor/*/apps/` are renamed to match `APP_ICON`; the
  tarball becomes `knightcode-linux-<arch>.tar.gz`.
- [ ] **Step 3: The remote server** is dropped (§1.7): its build, its
  strip, its `libcrypto` check and its archive.
- [ ] **Step 4: `script/linux`** — upstream's installer script names, paths
  and desktop entries follow, or an installed tarball puts `zed` back on
  PATH.
- [ ] **Step 5: Review, do not claim.**

---

## Task 8: Documentation and the pin

- [ ] **Step 1:** `architecture.md` §9, §10, §14 per §1.10; a Revision line
  and the date.
- [ ] **Step 2:** `repositories.md` §4's diagram gains the `engine/`
  directory, §5's table gains packaging, §6 gains the disk gotcha.
- [ ] **Step 3:** the fork's `README.md` — every upstream file this package
  touched, in the fork-surface table, with what changed; a short
  "Packaging" section naming the three scripts, `KNIGHTCODE_ENGINE_DIR`,
  and what is deliberately not built.
- [ ] **Step 4:** this file — Implementation notes for every departure, and
  Validation results, including what was not run and why.
- [ ] **Step 5:** bump `apps/desktop/ide` and commit both repositories.

---

## Implementation notes

Where the code departs from the task text above, and why. Line numbers in
the task text are unchanged; the tree is authoritative. To be filled as
tasks land; every departure gets one bullet.

- Task 0: `C:` had 18.8 GB free. `knightcode-ide/target` (119.3 GB, debug
  only, nothing running from it) was deleted with the owner's approval,
  leaving 127.9 GB.
- Task 0: the merge check ran as `git merge-tree --write-tree main
  upstream/main` rather than on a scratch branch, so the working tree was
  never touched. Upstream `7960b2a7c9` (2026-09-12T20:38Z): exit 0, no
  conflicts. Not taken onto `main`.
- Task 0: winget installs Inno Setup 6.7.3 per user, at
  `%LOCALAPPDATA%\Programs\Inno Setup 6`, not under `Program Files (x86)`.
  `BuildInstaller` looks in both.
- Task 0: `script/generate-licenses.ps1` uses PowerShell 7 syntax (`?:`),
  which Windows PowerShell 5.1 cannot parse, so the bundle runs under
  `pwsh`. PowerShell 7.6.6 was installed per user from winget. The same
  script installs `cargo-about` 0.8.2 when it is missing; it was installed
  ahead of the bundle (`cargo install --locked cargo-about@0.8.2`, 4.8
  minutes at two jobs) so the release build did not share the machine with
  it.
- Task 0: Rust builds here run with `CARGO_BUILD_JOBS=4` and
  `CARGO_PROFILE_DEV_DEBUG=0`. The first cold build at the default sixteen
  jobs failed: ten `rustc` processes, and the owner's running Zed, exited
  with `0xc0000409` within the same second (Application log, event 1000),
  which is how a Rust process aborts on a failed allocation. With four jobs
  20 GB of RAM stayed free. The same pattern is in the log for 2026-09-12
  05:14, during WP03.
- Task 1 Step 1: the new test also asserts that absence names the
  `engine/` path, so it needs no change to the existing absence test.
  Before the fix `cargo test -p knightcode_engine`: 25 passed, 1 failed,
  `the_binary_is_found_in_the_engine_directory_beside_the_executable`
  panicking at `environment.rs:184`, the error naming the bare sibling.
- Task 1 Step 3: after the fix, `cargo test -p knightcode_engine -p
  knightcode_agent -p knightcode_models` passed 26, 11 and 4. The one
  warning each test build reports is upstream's LNK4217 linker message
  (`wasmtime_c_api` and `tree_sitter`), the one WP03 recorded; the three
  crates themselves compile without warnings.
- Task 2: `"auto_update": false` in `default.json` failed
  `settings_store::tests::test_settings_store_basic`, which asserts
  upstream's default. Updates are already off at `poll_for_updates`, so the
  key only changed what a user reads; it is back to upstream's value rather
  than an upstream test being edited to match.
- Task 2 Step 7: the debug build on a fresh profile printed `could not find
  zed-cli from any of: bin/zed.exe, ./cli.exe`. `util::get_zed_cli_path`
  locates the launcher so `main.rs` can register it as git's askpass
  program on Windows, and the installers ship it as
  `bin\knightcode-ide.exe` (`bin/knightcode-ide` on Linux). An installed
  build would have lost git's credential prompts, and one compiled with
  `ZED_BUNDLE` set exits at launch when the lookup fails (`main.rs`, the
  `process::exit(1)` after the error), so `crates/util/src/util.rs` joins
  the fork surface with those two names.
- Task 2 Step 6: with `default.json` back to upstream's value, `cargo test
  -p settings` passed 37; `cargo build -p zed` exit 0, the one warning
  upstream's LNK4217. Step 7, the debug build with no `--user-data-dir`:
  `%LOCALAPPDATA%\KnightCode` (db, logs, extensions and six more) and
  `%APPDATA%\KnightCode` were created, and no file under either Zed
  directory changed; the executable's version resource reads
  `KnightCode Dev` (a debug build compiles the dev block), `KnightCodeAI`,
  `0.1.0`; the window closed on `WM_CLOSE` with exit 0. The application
  menu and the palette were not opened: the window was driven only from a
  script, so those two checks rest on the code and the build.
- Task 3 Step 3: the icon inside the first debug `zed.exe` was upstream's
  dev icon. `crates/zed/build.rs` declares `rerun-if-changed` only for
  `.git/logs/HEAD` and two environment variables, so replacing the `.ico`
  files does not rerun `windows_resources::compile`. A release build
  compiles its own copy of the build script and is not affected; a debug
  check needs a commit first. After the Task 1 commit the rebuilt debug
  `zed.exe` carries the new mark (extracted with `ExtractAssociatedIcon`
  and looked at). The window icon and taskbar button come from that
  resource and the About image from the verified PNG; Explorer's properties
  dialog was not opened.
- Task 2: `crates/zed/src/main.rs` asserted at compile time that
  `paths::APP_NAME` lowercased equals `CARGO_BIN_NAME`. With `APP_NAME`
  changed and the `zed` bin target kept (Exclusions), the build fails, so
  the assert is replaced by a comment. `APP_NAME_LOWERCASE` is read only in
  `paths.rs` to name directories; nothing compares it with the executable.
- Task 2: `LegalCopyright` reads `Copyright 2026 KnightCodeAI. Portions
  copyright 2022 - 2025 Zed Industries, Inc.` The executable is a
  derivative work, so the upstream notice stays; it is the one
  `Zed Industries` hit in `windows_resources.rs`.
- Task 2: `crates/cli/src/main.rs` changes only `../Zed.exe`. The MSYS2 and
  development-build entries are not layouts the installers produce.
- Task 2: the Help menu loses Zed's own channels as well as the release
  notes (fetched from zed.dev): Request Feature, Email Us, Zed Twitter,
  Join the Team. File Bug Report and the repository link point at
  `KnightCodeAI/knightcode-ide`. Documentation still opens zed.dev/docs,
  which documents the editor. The palette hides the same actions and
  `auto_update: check`, in WP03's filter in `main.rs`.
- Task 2: `crates/zed/resources/info/Permissions.plist` and
  `DocumentTypes.plist` name the application in macOS permission prompts
  and in Finder; both say KnightCode.
- Task 8: the fork README's table and `architecture.md` §8 listed
  `crates/agent_ui/src/agent_panel.rs` as unspent, but WP03's `225ee2b716`
  changed one string there (the new-thread menu's "Zed Agent" entry reads
  "KnightCode"). Both tables now say so; the check was `git diff
  knightcode-base HEAD` against the table, row by row.
- Task 3: upstream has no `app-icon.icns`; `cargo bundle` builds the app
  icon from the PNG list, so the generator writes `Document.icns` only.
  Pillow writes the 16pt icon only as its @2x entry: 8 entries, 32 to
  1024 px.
- Task 4: `bundle-windows.ps1` started `Launch-VsDevShell.ps1` from a
  hard-coded VS 2022 Community path; this machine has VS 18 Build Tools. It
  now asks `vswhere` for the install that carries the MSVC toolchain.
- Task 4: `-Install` started `ZedEditorUserSetup-x64-<version>.exe`, a
  name the script never produced; it starts `KnightCode-<arch>.exe`.
- Task 4: `StageEngine` copies with `Get-ChildItem | Where-Object |
  Copy-Item`, not `Copy-Item -Exclude`. Run against
  `packages/cli-win32-x64/bin`: 51 of 51 files staged, `knightcode.exe`
  left out.
- Task 4: `zed.iss`'s support URL is the fork's issue tracker. The
  `[UninstallRun]` section held only the appx removal and is gone, as is
  the Windows 11 `{#RegValueName}ContextMenu` key, which only the appx
  read. `zed.sh`, installed as `bin\knightcode-ide`, calls
  `knightcode-ide.exe`.
- Task 4 Step 6: ISCC 6.7.3 compiled `zed.iss` against a stub payload
  (`inno-stub2`, every `[Files]` source present as a stub): exit 0,
  `KnightCode-x86_64.exe`, 2,194,317 bytes.
- Tasks 6 and 7: `bundle-mac` no longer embeds a provisioning profile
  (Zed's team) or attaches a DMG licence agreement (Zed's terms), and its
  `IDENTITY` is empty until KnightCodeAI has a Developer ID.
  `script/install.sh` is upstream's download-and-install script; both
  download paths fetched Zed from cloud.zed.dev and now stop with a
  message, and the local-tarball path follows the new names.
  `script/uninstall.sh` follows them too, from `paths::APP_NAME` and
  `release_channel::app_id`, and no longer removes `~/.zed_server`, which
  belongs to an installed Zed.

---

## Required checks

Packaging resists unit tests. Where a check can be automated it is named
here; where it cannot, the manual check and its expected output stand in
its place. This list is the reviewer's checklist.

Automated:

- `locate_binary` finds the binary in `engine/` beside the executable, and
  still prefers the setting, the environment variable and a bare sibling in
  that order; absence still names a path (Task 1).
- `cargo test -p settings` parses `default.json` with `auto_update` false
  (Task 2).
- `cargo build -p zed` clean, and `cargo test -p knightcode_engine -p
  knightcode_agent -p knightcode_models` green, after every task that
  touches Rust.
- The icon generator's `--verify` pass reopens every file it wrote and
  asserts its sizes (Task 3).
- ISCC compiles `zed.iss` against a stub payload, exit 0 (Task 4).

Manual, with the expected observation:

- The installed tree has `engine\knightcode-engine.exe` beside
  `KnightCode.exe`, and the IDE starts its engine without
  `KNIGHTCODE_ENGINE_PATH` set (Task 5).
- A profile with no `~/.knightcode` reaches the panel's sign-in, completes
  an OAuth login, and runs a turn (Task 5).
- Cmd+K in a buffer, Cmd+K in the terminal, a commit message and Tab all
  work on that sign-in (Task 5).
- Quitting the IDE ends both engine processes within 8 seconds (Task 5).
- Uninstalling removes the install directory and the PATH entry (Task 5).
- The window icon, taskbar icon and About image are KnightCode's (Task 3).
- No Check for Updates in the menu or the command palette; no network call
  to zed.dev at startup (Task 2; watch it with Resource Monitor or a
  packet capture, and say which).

---

## Exclusions

Do not add in this work package:

- an update feed, an update server, or a rewritten `auto_update` — updates
  are off, and a release channel is its own phase;
- a signing certificate, a keystore, an Apple key or an Azure credential in
  either repository, or a change that weakens the guards that skip signing
  when they are absent;
- an MSI or an NSIS installer beside the Inno one;
- a Windows 11 appx shell extension (§1.4), a rewritten
  `explorer_command_injector`, or a recomputed package-family hash;
- `remote_server`, `auto_update_helper` or Sentry uploads in any bundle;
- a rename of the `zed` cargo bin target, of `Contents/MacOS/zed`, or of
  any crate;
- CI workflows for building or publishing installers — the release pipeline
  for the IDE is not Phase D;
- a first-run screen, a licence agreement of our own, or an onboarding flow
  (Phase E);
- changes to `packages/cli/src/core`, `packages/ai` or `packages/agent`, or
  any engine change at all: Phase D ships the engine, it does not modify
  it;
- anything in `editor`, `project`, `workspace`, `terminal`, `git`, `vim` or
  `gpui`.

---

## Validation

In the fork, from its root:

```powershell
cargo build -p zed
cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models
cargo test -p settings
```

Confirm no credential reaches the Rust side, unchanged from WP03:

```powershell
rg -n "api_key|API_KEY|Bearer |auth\.json|credential" crates/knightcode_agent crates/knightcode_models crates/knightcode_engine
```

Confirm packaging introduced no secret and no signing material:

```powershell
rg -n "BEGIN (RSA |EC )?PRIVATE KEY|\.pfx|\.p12|AZURE_CLIENT_SECRET|APPLE_NOTARIZATION_KEY\s*=" script crates
```

Expected: the variable *names* in `sign.ps1` and `bundle-mac`'s guards, and
nothing else.

Confirm the identity is gone from what the OS reads:

```powershell
rg -n "dev\.zed\.|Zed Industries|ZedIndustries" crates script --glob '!crates/zed/resources/windows/messages/*'
```

Expected: `crates/explorer_command_injector` (unbuilt, §1.4) and upstream
comments. Every other hit is a defect.

Confirm the fork surface:

```powershell
git diff --stat knightcode-base -- crates assets script | Select-String -NotMatch "crates/knightcode_"
```

Expected: the files in the File structure section and WP03's table, each at
or under its budget.

### Results, 2026-09-13

Fork branch `feat/packaging`, six commits on `6ff448240a`, head
`0fdd870ba7`. This repository's branch `feat/ide-packaging`.

Automated checks:

- `cargo test -p knightcode_engine -p knightcode_agent -p
  knightcode_models`: 26, 11 and 4 passed, 0 failed. The one warning each
  test build reports is upstream's LNK4217 linker message.
- `cargo test -p settings`: 37 passed, with `auto_update` at upstream's
  value (Implementation notes).
- `cargo build -p zed`: exit 0 after Tasks 1 to 3; the one warning is
  LNK4217.
- `cargo fmt --check` over every crate this package changed: exit 0.
- `generate-icons.py --verify`: eight PNGs and four ICOs at their sizes,
  `Document.icns` with 8 entries that each decode.
- ISCC 6.7.3 on `zed.iss` against a stub payload: exit 0, a 2,194,317-byte
  `KnightCode-x86_64.exe`.

Greps:

- Credentials: 17 hits in 8 files of the three KnightCode crates, none in
  a file this package changed; `environment.rs`, the one it did change,
  has none.
- Signing material: only `/tmp/zed-certificate.p12` in `bundle-mac`, the
  temporary file its signing block writes when all five signing variables
  are set. No key, certificate or secret in either repository.
- Zed's identity in `crates` and `script`, every remaining hit and why:
  - `crates/explorer_command_injector/AppxManifest*.xml`: not built (§1.4).
  - `crates/zed/resources/snap/`, `crates/zed/resources/flatpak/`,
    `script/flatpak/bundle-flatpak`: packages this work does not build.
  - `script/terms/terms.rtf`: Zed's terms; no installer references it now.
  - `crates/cli/src/main.rs:1093,1108`: detects Zed's own Flatpak by its
    id; there is no KnightCode Flatpak.
  - `crates/zed/src/main.rs:170`: `dev.zed.Oops`, the id of a crash
    notification, never shown.
  - `crates/windows_resources/src/windows_resources.rs:98`: the
    portions-copyright notice (Implementation notes).
  - `crates/gpui_linux/src/linux/x11/clipboard.rs:2`: a source copyright
    header.
  - `crates/extensions_ui/src/components/extension_card.rs:476`,
    `crates/etw_tracing/etw_tracing.rs:275`,
    `crates/gpui/examples/system_notifications.rs:106`: an extension's
    author, a trace profile's author and a GPUI example.
  - `script/bundle-windows.ps1:296`: the comment saying why the appx is
    not built.

Fork surface: `git diff --stat knightcode-base HEAD` outside
`crates/knightcode_*` is 52 files, each in the fork README's table.

Merge: `git merge-tree --write-tree HEAD upstream/main` at upstream
`7960b2a7c9` (2026-09-12T20:38Z): exit 0, no conflicts.

Windows (Task 5), this machine:

- Build: `pwsh script/bundle-windows.ps1` with `KNIGHTCODE_ENGINE_DIR` at
  `packages/cli-win32-x64/bin` (engine 0.6.2, built 2026-09-13 03:02) and
  `CARGO_BUILD_JOBS=4`: exit 0 in 52.9 minutes from a cold release target,
  ISCC's compile 93.6 s. `target/KnightCode-x86_64.exe`, 114,271,058
  bytes, SHA-256
  `4FB1392A683DE1F92D9AAB0320501FDE75A03DD9FEE109351F5158BE7F9CCF3A`,
  built at fork `0fdd870ba7`.
- The payload before installing: `KnightCode.exe` (359.3 MB); `engine\`,
  51 files, `knightcode-engine.exe` among them and `knightcode.exe` not;
  `bin\knightcode-ide.exe` and `bin\knightcode-ide`. No `Zed.exe`,
  `auto_update_helper.exe`, `tools\`, appx or explorer injector, and
  `remote_server` was never built. `KnightCode.exe`'s version resource
  reads `KnightCode`, `KnightCodeAI`, `0.1.0+stable.0fdd870ba7…`; the
  setup's reads `KnightCode Setup`, `KnightCodeAI`, `0.1.0`. Both carry the
  new icon, extracted and looked at.
- Install, silent (`/VERYSILENT`, default tasks): exit 0 in 16 s, into
  `%LOCALAPPDATA%\Programs\KnightCode`, with `engine\knightcode-engine.exe`
  present and no bare sibling. Add/Remove Programs: KnightCode,
  KnightCodeAI, 0.1.0, knightcode.dev and the fork's issue tracker. `bin`
  is on the user PATH; the `knightcode` URL scheme opens `KnightCode.exe`;
  the existing `zed` scheme still opens the installed Zed.
- Launch, with no setting and no `KNIGHTCODE_ENGINE_PATH`: `KnightCode.exe`
  spawned `...\KnightCode\engine\knightcode-engine.exe` as its direct child;
  the child's command line is the bare quoted path, with no shell and no
  token. Nothing on stderr, so the launcher lookup for git's askpass found
  `bin\knightcode-ide.exe`.
- Quit by `WM_CLOSE`: the IDE exited 0 within 0.2 s, and the engine was
  gone 0.5 s after.
- Uninstall, silent: the install directory, the Add/Remove Programs entry,
  the PATH entry and the `knightcode` scheme are gone, and the `zed` scheme
  is untouched. `%LOCALAPPDATA%\KnightCode`, the user's data, stays.
- Not run here: this profile has Bun, Node, the CLI and a signed-in
  `auth.json`, so it is not the clean machine. The exit condition, sign-in
  inside the application, an agent turn, Cmd+K in a buffer and in the
  terminal, a commit message and Tab on a machine with no developer
  tooling, is the owner's run on their laptop with the installer above
  (Task 5 Step 4). The wizard's pages, the licence page among them, and
  SmartScreen's prompt were not seen: the install here was silent.

macOS (Task 6): not run; no Mac here. Owed, on a Mac with Xcode and the
engine built by `bun run scripts/build.ts --engine --target=darwin-arm64`:
`KNIGHTCODE_ENGINE_DIR=<that directory> script/bundle-mac` produces
`KnightCode-aarch64.dmg`; the bundle holds
`Contents/MacOS/engine/knightcode-engine` beside `Contents/MacOS/zed`; the
app launches and starts its engine. One risk to check first: codesign, ad
hoc included, may refuse the non-code files under `Contents/MacOS/engine`.
If it does, the engine moves to `Contents/Resources/engine` and
`locate_binary` learns that path.

Linux (Task 7): not run; no Linux machine here. Owed, with the engine from
`bun run scripts/build.ts --engine --target=linux-x64`:
`KNIGHTCODE_ENGINE_DIR=<that directory> script/install-linux` builds
`knightcode-linux-x86_64.tar.gz` and installs it; `~/.local/bin/knightcode-ide`
launches the IDE, which starts its engine from `libexec/engine`; the window
groups under the `dev.knightcode.KnightCode` desktop entry and its icon;
`script/uninstall.sh` removes the install, the link and the entry.

---

## Stop condition

WP04 is complete when:

- a Windows machine with no Bun, no Node, no npm and no CLI installs the
  IDE from the built installer, signs in inside the application, and
  completes an agent turn, with Cmd+K in a buffer, Cmd+K in the terminal, a
  commit message and Tab served by that same sign-in;
- the installed IDE finds its engine with no setting and no environment
  variable, and quitting the IDE ends every engine process;
- nothing the operating system displays — install directory, data
  directory, executable name, icon, publisher, shortcut, bundle identifier,
  instance mutex, Add/Remove Programs — says Zed;
- no surface polls, downloads from, or links to zed.dev;
- the macOS and Linux bundle scripts are written, reviewed and committed,
  with their unverified status recorded in Validation and in the fork's
  README;
- every automated check in Required checks passes, and every grep in
  Validation returns only its expected matches;
- the upstream files changed are exactly those in the File structure
  section, each recorded in the fork's `README.md`, and `git merge
  upstream/main` into a scratch branch conflicts only inside them;
- nothing under `packages/cli/src/core`, `packages/ai` or `packages/agent`
  changed, and no engine source changed at all.

---

## Questions for the owner

Answers to 1 and 2 change Task 0; 3 changes Task 2; 4 changes Task 5; 5 and
6 change nothing in this package but decide whether its output can be given
to anyone.

1. **Disk.** *Answered 2026-09-13:* the owner approved deleting
   `knightcode-ide/target` (119.3 GB, debug only, nothing running from it).
   It is gone and `C:` has 127.9 GB free. The next debug build starts cold.
2. **The engine rebuild.** *Answered 2026-09-13:* approved and run.
   `packages/cli-win32-x64/bin/knightcode-engine.exe` is 122.3 MB, written
   2026-09-13 03:02, version 0.6.2; `test/engine/engine-entry.test.ts` 3
   passed.
3. **The version number.** *Answered 2026-09-13:* `0.1.0`. Task 2 sets it
   in `crates/zed/Cargo.toml`, and every upstream merge resolves that line
   to ours. The line joins the fork-surface table so the conflict is
   expected, not a surprise.
4. **The clean machine.** *Answered 2026-09-13:* the owner's laptop. Task 5
   builds the installer here and hands it over; the laptop run is the
   owner's, with the Task 5 Step 4 checklist.
5. **Distribution and the GPL.** *Answered 2026-09-13:*
   `KnightCodeAI/knightcode-ide` is public (verified with `gh repo view`,
   visibility `PUBLIC`). The source offer is the repository link.
6. **macOS signing.** *Answered 2026-09-13:* no Apple Developer account.
   macOS waits; Task 6 writes the script unsigned, as planned.
