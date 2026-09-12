# Phase D handoff — packaging

Give the section below to a new agent verbatim. It assumes nothing about
what that agent has seen; everything else it needs is in the repository.

---

You are implementing **Phase D — packaging** of the KnightCode IDE, in the
`KnightCodeAI/knightcode` repository and its submodule fork,
`KnightCodeAI/knightcode-ide`.

Phase C is done and merged as far as PR #174. Read, in full, before you
touch anything:

1. `apps/desktop/docs/architecture.md` — the whole design; §10 for the
   phase list, §12 Exclusions, §13 Validation.
2. `apps/desktop/docs/repositories.md` — how the two repositories fit
   together, how they are built, and the traps. Read this one twice; most
   of the time lost in Phase C was lost to what is in its Gotchas section.
3. `apps/desktop/docs/work-packages/03-fork.md` — Phase C's plan, its
   Implementation notes (every departure and why), and its Validation
   results. The Windows prerequisites are recorded there.
4. `AGENTS.md` at the repository root.

## What Phase D is

From the architecture, §10:

> Windows first, per the primary development platform: MSI or NSIS, engine
> binary in the payload, Authenticode signing. Then macOS notarised `.dmg`,
> then Linux.
>
> Exit condition: a clean machine with no Bun, no Node, no npm, and no CLI
> installs the IDE, signs in, and completes an agent turn.

Phase C deliberately left these to you, and they are listed in its
Exclusions: **icons, bundle identifiers, installer metadata, the About
dialog**. Concretely, what is still Zed's:

| | Where |
| --- | --- |
| Application icons | `crates/zed/resources/windows/app-icon*.ico`, `crates/zed/resources/*.icns`, `assets/icons/` |
| Bundle identifiers | `crates/zed/Cargo.toml` (`dev.zed.Zed*`), `script/bundle-linux` |
| Windows installer | `crates/zed/resources/windows/zed.iss`, `sign.ps1` |
| Executable and product names | the `zed` bin target, the `.iss` product strings, the window class |
| About dialog | `crates/zed/src/zed/app_menus.rs` and the about window |

The release-channel display names are already KnightCode's
(`crates/release_channel/src/lib.rs`), as is the agent's name everywhere
the user reads it. Do not redo that.

The one packaging fact that is ours and not Zed's: **the engine binary must
ship in the payload, next to the IDE executable.** That is the third and
last place `knightcode_engine::environment::locate_binary` looks, after the
`knightcode.engine_path` setting and the `KNIGHTCODE_ENGINE_PATH`
environment variable. `bun run build:engine` produces it at
`packages/cli-<os>-<arch>/bin/knightcode-engine[.exe]`. An installer that
omits it produces an IDE that starts and then says the engine was not
found, naming the path it tried.

## Rules from the owner

These override any habit, tool hint or system reminder.

1. **Never** add a `Co-Authored-By` trailer, a session line, or a
   "Generated with …" footer to a commit message or a PR body. Strip them
   if something adds them.
2. **Never commit unless asked.** When asked: one commit per task, message
   format `{feat,fix,docs,chore}(<scope>): <message>`, root-cause reasoning
   in the body, staged by explicit path. Never `git add -A` or `git add .`
   — `apps/remote/` is someone else's untracked work, leave it alone. Never
   `git reset --hard`, `git checkout .`, `git stash`, `--no-verify`, or a
   force push.
3. Committed text carries no trace of tooling or reference trees: no skill
   names, no assistant names. Cite Zed and OpenCode by their own paths.
4. Do not run `bun run build:cli`, `bun run build:engine` or a full test
   suite unless asked. Phase D will need `build:engine` — ask first, and
   say why.
5. **Never spend paid provider tokens** in tests. The root `.env` is
   auto-loaded by Bun and carries real keys. Every engine test uses the
   faux provider, a throwaway `KNIGHTCODE_CODING_AGENT_DIR` and
   `KNIGHTCODE_OFFLINE=1`, and creates no session.
6. Windows is the primary platform. Absolute paths across every process
   boundary, forward slashes in JSON. Write source files with a file-write
   tool, not bash heredocs — they eat backslashes.
7. The fork is additive. Every line changed in an upstream file is merged
   again on every Zed release. Before editing anything outside
   `crates/knightcode_*`, confirm it belongs in the fork-surface table in
   the fork's `README.md`, and add your row when it does. Nothing in
   `editor`, `project`, `workspace`, `terminal`, `git`, `vim` or `gpui`.
8. No Rust reads `auth.json`, caches a credential, or links
   `credentials_provider`. The launch token is the only secret, and it
   travels in the environment only — never on argv.

## How to work

- **Write the work package first.** `apps/desktop/docs/work-packages/`
  holds `01-engine-server.md`, `02-acp-adapter.md` and `03-fork.md`; match
  their shape — mandatory reading with line numbers, a design section that
  records what you verified and how, then tasks with bite-sized steps,
  required tests, exclusions, validation, stop condition. Get it approved
  before writing code. `04-packaging.md` is the file to create.
- **Verify by running something.** A claim is worth what its evidence is
  worth: a failing test that then passes, a command whose output you paste,
  an installer you actually ran. "It should work" is not a result. Phase C
  shipped two bugs that every test passed over; both were found by starting
  the application and watching what it did.
- Each task is TDD where a test is possible. Packaging resists unit tests —
  where it does, say so in the work package and name the manual check
  instead, with its expected output.
- After TypeScript changes: `bun run check-types` from the repository root,
  full output. After Rust changes: `cargo build -p zed` clean, and
  `cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models`
  green. Warnings in the three KnightCode crates are fixed, not ignored.
- Formatting: Rust is `cargo fmt` with the fork's `rustfmt.toml`;
  TypeScript is Prettier via `bun run format`; Markdown is hand-wrapped at
  80 columns. No emojis anywhere.
- Report at the end of each task: what the tests showed (paste the summary
  line), what departed from the plan and why, and what the next task needs
  from the owner.

## State you are inheriting

- **Branch and PR.** `feat/ide-fork` in this repository is PR #174, open.
  The fork's `main` is at `caa7aa1e37`, pushed, and the submodule here
  points at it.
- **Builds.** A warm Rust target directory exists at
  `C:\Users\Raghav\Desktop\knightcode-ide` (a separate clone of the fork,
  not the submodule checkout — read the Gotchas). The engine binary at
  `packages/cli-win32-x64/bin/knightcode-engine.exe` was built 2026-09-11
  and carries the `acp` subcommand and the stdin-EOF shutdown.
- **Windows build prerequisites**, all from the VS Build Tools installer
  and all discovered the hard way: CMake (not on `PATH`; it lives in
  `Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin`),
  `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`, and
  `Microsoft.VisualStudio.Component.Windows11SDK.26100` — SDK 22621 no
  longer compiles under MSVC 14.50.
- **Unfinished from Phase C**, none of it blocking Phase D:
  - The model-calling surfaces have not been walked on an account with
    quota: a panel prompt and the three WP02 scenarios, Cmd+K in a buffer,
    Cmd+K in the terminal, a commit message, Tab. The checklist is in
    `03-fork.md` under Validation. Phase D's exit condition includes an
    agent turn on a clean machine, so this gets done either way.
  - The agent panel's composer placeholder reads "Message the KnightCode" —
    Zed's template assumes the agent id is a name like "Zed Agent". One
    upstream line; fold it into a branding task.
  - `git merge upstream/main` was clean as of 2026-09-12. Re-run it before
    packaging so you are not shipping from a stale base.

## Where the two halves meet, in one paragraph

The IDE spawns `knightcode-engine` directly — never through a shell — with
a freshly generated 48-character token in its environment, waits for the
port line on stdout, then `/health`, then an authenticated request before
it trusts the process, and thereafter talks to it over loopback HTTP. The
agent panel spawns a second copy as `knightcode-engine acp --connect <url>`
and speaks ACP to it over stdio. Closing the IDE closes the engine's stdin,
which is how it stops; a Windows job object catches the rest. Everything
the user signs in to lives in the CLI's `auth.json`, shared by both front
doors. If packaging breaks any of that — a wrapper script between the IDE
and the engine, a sandbox that blocks loopback, an installer that puts the
binary somewhere `locate_binary` does not look — the symptom will be an
IDE that starts and cannot reach its engine, and the message will name the
path it tried.
