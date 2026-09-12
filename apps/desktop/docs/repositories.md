# The two repositories

Date: 2026-09-12

The desktop IDE is built from two repositories that ship as one product.
This document is the map: what lives in each, why they are separate, how
git links them, how the two halves find each other at runtime, and what to
do in the situations where the split bites.

`architecture.md` is the design; this is the plumbing.

---

## 1. The two repositories

| | `KnightCodeAI/knightcode` | `KnightCodeAI/knightcode-ide` |
| --- | --- | --- |
| What | This monorepo: the CLI, the AI stack, the engine | The IDE: a fork of Zed |
| Language | TypeScript, built with Bun | Rust |
| Licence | MIT | GPL-3.0-or-later (Zed's) |
| Upstream | none | `zed-industries/zed`, remote `upstream` |
| Visibility | private | private |
| Linked as | the parent | a submodule at `apps/desktop/ide` |

### Why they are separate

Three reasons, in order of weight.

**The licence.** Zed is GPL-3.0-or-later. A fork of it is a derivative work
and stays GPL. The engine is MIT and is a separate program the IDE talks to
over a loopback socket and a pipe — not a library it links. Keeping them in
different repositories keeps that boundary visible instead of a claim in a
comment.

**The merge.** The fork tracks upstream Zed forever: every Zed release is a
`git merge` into our `main`. That only stays cheap while the fork's history
is Zed's history plus our commits. Vendoring Zed into this monorepo would
make each merge a manual re-application.

**The cadence.** The engine changes with the AI stack, several times a week.
The fork changes when a seam changes, and otherwise only to absorb upstream.
Separate repositories let each move at its own speed, with the submodule
pointer recording which pair was known to work together.

---

## 2. What is in each

### This repository, the part the IDE cares about

```text
packages/cli/src/
  engine-entry.ts            the knightcode-engine binary's entry point
  engine/
    server.ts                HTTP routing and the launch-token guard
    accounts.ts              /v1/accounts, the login state machine
    models.ts                /v1/models
    completions.ts           /v1/chat/completions, /v1/completions
    events.ts                /events (SSE)
    proxy.ts                 loopback NO_PROXY
    acp/                     the ACP adapter: knightcode-engine acp
scripts/build.ts             --engine builds the engine binary
apps/desktop/
  docs/                      architecture.md, this file, work-packages/
  ide/                       the submodule -> knightcode-ide
```

Nothing under `packages/cli/src/core`, `packages/ai` or `packages/agent` is
IDE-specific. The engine is a second front door onto the same core the CLI
uses, which is why one sign-in serves both.

### The fork

Zed's tree, plus three crates of ours and a short list of one-line edits to
upstream files.

```text
crates/knightcode_engine/    the engine as the IDE sees it
  settings.rs                the `knightcode` settings section
  environment.rs             token, NO_PROXY, where the binary is (pure)
  process.rs                 spawn, three-phase readiness, stop (no gpui)
  client.rs                  the engine's HTTP routes
  login.rs                   one login, polled
  engine.rs                  the gpui entity: status, restart, events
crates/knightcode_agent/     seam 1: the agent panel
  knightcode_agent.rs        KnightCodeAgentServer
  connection.rs              KnightCodeConnection, the sign-in wrapper
crates/knightcode_models/    seams 2 and 3
  knightcode_models.rs       the LanguageModelProvider
  state.rs                   accounts, models, the login in progress
  model.rs                   one engine model as a Zed LanguageModel
  request.rs                 LanguageModelRequest -> OpenAI request
  sign_in.rs                 the settings view
  edit_prediction.rs         the Tab delegate
```

The upstream files we touch are listed in the fork's `README.md` and in
`architecture.md` §8. That table is a budget, not a target: every line in it
is merged again on every Zed release.

---

## 3. How git links them

`apps/desktop/ide` is a **submodule**. Two things record it:

- `.gitmodules`, a tracked file, maps the path to the fork's URL.
- The tree entry at `apps/desktop/ide` is a **gitlink**: mode `160000`, and
  its "content" is one commit SHA in the fork.

So this repository does not contain the fork's files. It contains a pointer
to one commit of it. `git log` here shows the pointer moving; the fork's own
history is in the fork.

```console
$ git submodule status
 58ae406957b947f3d322ea1a614ea4109eb4daca apps/desktop/ide (knightcode-base-9-g58ae406957)
```

The leading character matters:

| | Meaning |
| --- | --- |
| (space) | the checkout is at the recorded commit |
| `+` | the checkout is at a *different* commit than the one recorded — commit the pointer or check the recorded one out |
| `-` | the submodule is not initialised — run `git submodule update --init` |

A dirty working tree inside the submodule does not show here at all. It
shows in the outer `git status` as a lowercase `m`:

```text
 m apps/desktop/ide     uncommitted changes inside the submodule
 M apps/desktop/ide     the pointer moved (a new commit is checked out)
```

### The third repository

Zed itself. It is not a submodule of anything: it is a **remote** on the
fork, named `upstream`, and remotes are a property of a clone, not of a
repository. A fresh clone — including the one git makes for the submodule —
has only `origin`. Add it wherever you intend to merge:

```powershell
git -C apps/desktop/ide remote add upstream https://github.com/zed-industries/zed.git
```

`knightcode-base` is a tag on the upstream commit the fork started from
(`a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b`, 2026-09-10). Everything after
it is ours; `git diff knightcode-base` is exactly the fork surface.

---

## 4. How the halves find each other at runtime

Git links the source. At runtime the link is a **binary path**, a
**generated token** and a **loopback port**.

```text
 IDE process (zed.exe)                        engine process
 ─────────────────────                        ──────────────
 knightcode_engine::init
   locate the binary  ─────── spawn ────────► knightcode-engine
     1. knightcode.engine_path (setting)        KNIGHTCODE_ENGINE_TOKEN=<48 hex>
     2. KNIGHTCODE_ENGINE_PATH (env)            KNIGHTCODE_ENGINE_PORT=<on restart>
     3. next to the IDE executable              stdin piped, stdout piped
                                                      │
   readiness, three phases                            │ {"type":"listening","port":N}
     1. the port line       ◄─────────────────────────┘
     2. GET /health until 200
     3. GET /v1/accounts with the token
                                                 http://127.0.0.1:N
   seam 1  knightcode-engine acp --connect <url>  ──► the ACP adapter, a child
   seam 2  POST /v1/chat/completions              ──► inline assist, commit msgs
   seam 3  POST /v1/completions                   ──► Tab
   status  GET /events                            ──► account/model changes
```

Three properties fall out of this and are worth keeping in mind when
changing either side:

- **The token is the only secret the Rust holds.** It is generated per
  launch, travels in the child's environment (never on argv), and is proved
  before any adapter is spawned. No Rust reads `auth.json`.
- **The engine dies with the IDE.** It is spawned through Zed's
  `util::process::Child`, which puts it in a Windows job object, and it
  exits when its stdin closes. Quitting, crashing or killing the IDE all end
  it.
- **Credentials are shared with the CLI.** The engine uses the CLI's own
  `auth.json`. Signing out in the IDE signs the CLI out too, and the other
  way round. This is deliberate — one login serves both front doors — but it
  means a sign-out during testing is not a local act.

---

## 5. Working in the pair

### Clone it fresh

```powershell
git clone --recurse-submodules https://github.com/KnightCodeAI/knightcode.git
```

Already cloned without it:

```powershell
git submodule update --init apps/desktop/ide
```

### Build both halves

```powershell
# the engine (this repo) -> packages/cli-win32-x64/bin/knightcode-engine.exe
bun run build:engine

# the IDE (the fork) -> target/debug/zed.exe
cd apps\desktop\ide
$env:PATH = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;$env:PATH"
cargo build -p zed
```

The first Rust build is 30–60 minutes and tens of gigabytes. Windows needs
three things beyond rustup, all from the VS Build Tools installer, all
documented in the fork's `docs/src/development/windows.md`:

- **CMake** — not on `PATH` by default; it ships inside the Build Tools at
  `Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin`.
- **`Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`** — the
  Spectre-mitigated CRT libs, or `msvc_spectre_libs` panics.
- **`Microsoft.VisualStudio.Component.Windows11SDK.26100`** — SDK 22621's
  headers no longer compile under MSVC 14.50 (`webrtc-sys` fails with
  `error C2061` in `fileapi.h`).

### Run the IDE against a local engine

```powershell
$env:KNIGHTCODE_ENGINE_PATH = "C:/Users/<you>/Desktop/knightcode/packages/cli-win32-x64/bin/knightcode-engine.exe"
& "C:\Users\<you>\Desktop\knightcode-ide\target\debug\zed.exe" --user-data-dir "$env:LOCALAPPDATA\KnightCodeIDE" <project>
```

`--user-data-dir` keeps the dev build's settings, database and logs away
from an installed Zed's. Forward slashes in the engine path: it crosses a
process boundary as JSON in settings, and a backslash there is an escape.

### Change the Rust, then record it

Rust changes are committed **in the fork**, then the pointer is bumped
**here**. Two commits, two repositories, in that order:

```powershell
# in the fork
cd apps\desktop\ide          # or a separate clone, see the gotcha below
git add crates/knightcode_engine ; git commit ; git push origin main

# here
cd ..\..\..
git add apps/desktop/ide ; git commit -m "chore(desktop): bump the IDE pin"
```

The pointer bump is the whole point of the submodule: it records which fork
commit was tested with which engine.

### Merge upstream Zed

```powershell
cd apps\desktop\ide
git remote add upstream https://github.com/zed-industries/zed.git   # once per clone
git fetch upstream
git merge upstream/main            # or a release tag, when one is cut
```

Conflicts should appear only in the files the fork's `README.md` lists. One
that will not conflict and must still be checked by hand every time: a
method added to `acp_thread::AgentConnection` compiles without a delegation
in `crates/knightcode_agent/src/connection.rs`, and the trait's default then
silently disables that feature for KnightCode. Compare the trait with the
wrapper after every merge.

### Where does a change go?

| The change | Repository |
| --- | --- |
| A route, a model, an agent behaviour, anything the CLI shares | this one, under `packages/` |
| Anything the user sees in the editor window | the fork |
| The wire contract between them | both, engine first |
| The plan, the architecture, this file | this one, `apps/desktop/docs/` |
| Icons, installer, bundle identifiers (Phase D) | the fork |

---

## 6. Gotchas

**Two working trees of the fork.** The submodule checkout at
`apps/desktop/ide` is a full clone. If you also keep a separate clone (for
example `C:\Users\<you>\Desktop\knightcode-ide`, which has the warm
`target/` directory), the two can drift: edits in one are invisible to the
other, and `git submodule status` only sees the checkout. Pick one as the
place you edit. If work appears in the other, verify it, commit and push it
from wherever it landed, then bring the other in line with `git fetch` and
`git checkout <sha>`.

**Line endings.** `core.autocrlf` is `true`, so files written with LF show
as modified until git normalises them. A `git diff` that prints nothing for
a file `git status` calls modified is exactly this, and is harmless. When
comparing working-tree content with a commit, strip `\r` first.

**Checkout refuses over "local changes" that are identical.** Same cause.
Confirm the content matches the target commit (strip `\r`, hash both), then
`git checkout -- <files>` and switch.

**A detached HEAD in the submodule is normal.** Git checks submodules out at
a commit, not a branch. Committing there works, but push with an explicit
refspec — `git push origin HEAD:main` — or the push goes nowhere useful.

**`git status` in the outer repo does not show fork edits in detail.** A
lowercase `m` is all you get. `git -C apps/desktop/ide status` is the real
answer.

**The engine binary is not in either repository.** It is a build artefact.
A fork checkout alone cannot start the IDE's engine; either build it here or
point `KNIGHTCODE_ENGINE_PATH` at one. Phase D puts it in the installer's
payload, next to the IDE executable, which is the third lookup.

---

## 7. Current pins

| | |
| --- | --- |
| Fork base | `a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b`, upstream `main`, 2026-09-10, tagged `knightcode-base` |
| Nearest upstream tags | `v1.19.2` (stable), `v1.20.0-pre` |
| Rust toolchain | 1.97.1, pinned by the fork's `rust-toolchain.toml` |
| Phase | C implemented; D (packaging) and E (first-run) open |
