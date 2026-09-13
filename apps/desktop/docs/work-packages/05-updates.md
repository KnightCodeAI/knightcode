# WP05 — Releases and updates

Status: implemented 2026-09-13. Open: the first tagged release run on the
five CI runners, and the update walked on macOS and Linux.

**Goal:** an installed KnightCode IDE updates itself. Nobody downloads an
installer twice.

**Owner's answers (2026-09-13):**

- Installers are built in CI and published as GitHub Releases of
  `KnightCodeAI/knightcode-ide`. knightcode.dev serves the update check.
- All five targets: Windows x86_64, macOS aarch64 and x86_64, Linux x86_64
  and aarch64. These are the CLI's targets.
- Pull requests in the IDE repository get their own checks: tests and a
  full build.

---

## 1. What the fork inherited

Zed's updater was intact. Phase D only switched it off: `poll_for_updates`
returned `false`, Check for Updates left the menu and the command palette,
and `auto_update_helper` was not built. The flow it switches back on:

1. `AutoUpdater` asks `<feed>/releases/<channel>/latest/asset?asset=&os=&arch=`
   every hour, and on Check for Updates, for `{ version, url }`.
2. If the version is newer, it downloads `url`.
3. It installs the download:
   - **Windows:** runs the Inno Setup installer with `/verysilent
     /update=true`. In that mode the installer writes the new files into
     `install\` and writes `updates\versions.txt`. When the IDE quits or
     restarts, `tools\auto_update_helper.exe` moves the old files into
     `old\` and the new ones into place, and rolls back if a step fails.
   - **macOS:** mounts the `.dmg` and `rsync`s the app over the running one.
   - **Linux:** unpacks the tarball and `rsync`s it over `~/.local`.

## 2. What changed

**The feed.** `get_release_asset` asks `https://knightcode.dev/api/ide`, not
Zed's cloud. It sends no telemetry identifiers, only the channel, the asset
name `knightcode`, the OS and the architecture. `KNIGHTCODE_UPDATE_URL`
points a build at another feed for testing.

**A signature on every download.** The installers are unsigned, and the
Windows one runs silently. A feed that alone decided what runs would let
anyone who controls knightcode.dev, or a release asset, run code on every
install. So:

- `ReleaseAsset` carries `signature`: base64 Ed25519 over the SHA-256
  digest of the file.
- `verify_release` checks that digest against `RELEASE_SIGNING_KEY`, which
  is compiled into the IDE, before anything installs the download.
- CI signs with `openssl pkeyutl -sign -rawin` over the digest.
  `test_verify_release` checks an OpenSSL-made signature with the code the
  IDE runs, so a mismatch between the two surfaces as a failing test.

`ring` does the verification. It was already compiled into the IDE through
`aws-config`, so no new crate ships.

**Only bundled builds update.** Every build of the fork reports the stable
channel, a developer's `cargo run` included (Phase D). Upstream's
`poll_for_updates` is restored, and `main.rs` calls `auto_update::init` only
when `ZED_BUNDLE`, which only the bundle scripts set, was present at compile
time. Without that gate, a development build would download a release and
install it over the installed IDE.

**The Windows helper knows KnightCode's files.** The job list moves
`KnightCode.exe`, `bin\knightcode-ide.exe`, `bin\knightcode-ide` and the
whole `engine\` directory. The installer already stages the engine in
`install\engine` during an update, because its `[Files]` entry uses
`GetInstallDir`. The engine exits within a second of the IDE, inside the
helper's retry window, and the Restart Manager list names it too.
`bundle-windows.ps1` builds the helper again, and `zed.iss` installs
`tools\*`.

**Bundle names.** The macOS updater mounts the `KnightCode` volume. The
Linux updater copies `knightcode<suffix>.app`. These are the names
`bundle-mac` and `bundle-linux` give them.

**Release notes.** Stable and Preview link to the GitHub Release for the
running version. The "Updated to" notification opens that page. Rendering
notes in a tab stays hidden, because that reads Zed's server.

**The menu.** Check for Updates is back in the application menu and the
command palette.

## 3. The release pipeline

`.github/workflows/knightcode-release.yml` in the IDE repository runs on a
`v*` tag:

1. **`version`** checks that the tag matches `version` in
   `crates/zed/Cargo.toml`. A suffixed tag (`v0.2.0-rc.1`) is a prerelease.
2. **`bundle`** runs once per target, on `windows-2022`, `macos-15` (both
   macOS targets; x86_64 cross-compiles) and `ubuntu-22.04` plus
   `ubuntu-22.04-arm`. Each job:
   - checks out this repository at `KNIGHTCODE_REF`;
   - builds the engine with `bun run scripts/build.ts --engine
     --target=<target>`;
   - runs that platform's bundle script with `KNIGHTCODE_ENGINE_DIR`
     pointing at the result.
3. **`publish`** checks that `KNIGHTCODE_UPDATE_SIGNING_KEY` derives the
   public key the workflow names (`RELEASE_PUBLIC_KEY`, the same key the
   IDE holds). It then signs every file, attaches `<file>.sig`, and creates
   the GitHub Release.

`apps/web/app/api/ide/releases/[channel]/[version]/asset/route.ts` answers
the IDE:

- It reads `releases/latest` of the IDE repository, which already excludes
  drafts and prereleases, with `GITHUB_TOKEN` when it is set.
- It picks the installer for the platform in `lib/ide-release.ts`, then
  fetches its `.sig`.
- It returns `{ version, url, signature }`, cached for 300 s.
- Anything else, the remote-server asset included, is a 404 or a 502. An
  automatic check treats either as "no update".

**The key.** The private key exists in the IDE repository's secret, plus
one offline copy the owner keeps. If it is lost, every install stays on its
version until the user reinstalls by hand. If it leaks, whoever has it can
ship code to every install. Rotating it takes a release signed with the old
key that carries the new public key.

## 4. Checks

`.github/workflows/knightcode.yml` in the IDE repository runs on every pull
request and every push to `main`, on Windows, macOS and Linux:

- `cargo fmt --check` (Linux only);
- the tests of the KnightCode crates, the update crates and `settings`;
- `cargo build -p zed`.

Zed's own workflows stay in the tree and skip. They are gated to
`zed-industries` repositories and to runners KnightCodeAI does not have.

## 5. Validation

Windows, this machine:

- `cargo test -p auto_update -p auto_update_helper -p release_channel`
- `cargo build -p zed`
- `bun test lib/ide-release.test.ts` in `apps/web`
- An update end to end: install a bundled 0.1.0, serve a signed 0.1.1 from
  a local feed through `KNIGHTCODE_UPDATE_URL`, quit, and confirm that
  0.1.1 and its engine are installed. A tampered signature must be refused.

Owed:

- The first tag run on all five runners. Its logs are the first evidence
  that `bundle-mac` and `bundle-linux` run.
- The update walked on a Mac and a Linux machine.
