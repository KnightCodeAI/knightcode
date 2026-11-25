# Desktop parity recipe

The baseline app is `f4e10b2d3` (main merged into the branch; no desktop or
app-server source changed since `3e5cd40c3`). Product renderer code must
remain unchanged until its baseline has been captured. See
[inventory.md](inventory.md) for the surface and behavior gates; screenshots
do not replace those behavior checks.

## Build and run

From the repository root:

```sh
bun install --frozen-lockfile
bun run hydrate:model-data
bun run apps/desktop/scripts/stage-server.ts --platform=win32 --arch=x64
cd apps/desktop
bun run package
bun run test:parity
```

The staging target must match the host. Use `darwin` or `linux` and the
appropriate architecture on those hosts. Linux Electron tests need a display;
CI can use `xvfb-run -a bun run test:parity`.

The suite needs `fd` (for `@` file suggestions). It takes
`KNIGHTCODE_PARITY_FD`, else `~/.knightcode/agent/bin/fd`, else `fd`/`fdfind`
on PATH, and copies it into the scratch agent dir.

To record baselines before a migration, explicitly run:

```sh
bun run test:parity --update-snapshots=missing
bun run test:parity
```

Recording is not verification. The second command must report zero changed
pixels on fresh fixtures. Ordinary comparison uses `updateSnapshots: none`:
a missing baseline fails instead of silently creating an expected image.
Never update baseline images to make a migration regression pass. Inspect
the expected, actual and diff images in `apps/desktop/test-results/parity/`.

## Files

- `test/fixtures/desktop.ts`: the scratch fixture (profile, agent dir, project,
  environment). Its isolation is unit-tested in `test/main/desktop-fixture.test.ts`.
- `test/parity/harness.ts`: Electron launch/relaunch, `capture` and its
  normalization rules.
- `test/parity/desktop.e2e.ts`: the screen set (home, composer, terminal,
  preview, settings pages, thread tools, Git dialogs, trust).
- `test/parity/flows.e2e.ts` and `flows-more.e2e.ts`: the behavior matrix's
  flows (requests, Git writes and failures, windows, reconnect, lifetimes,
  persistence).
- `packages/cli/test/fixtures/faux-app-server.ts`: the scripted faux model;
  its header lists every prompt it answers.

## Fixed inputs

- Real production Vite output runs in Electron. This is not a mocked React
  tree or a browser page pretending to be the desktop app.
- The app server is `packages/cli/test/fixtures/faux-app-server.ts`, the same
  native faux-provider infrastructure used by the existing desktop E2E suite.
  No HTTP model service, provider credentials or paid requests are needed.
- Each test gets a new scratch root with its own project, agent directory,
  user-data directory, home directory, Claude/Grok configuration roots and
  Git/GitHub configuration. Only OS process-launch/display variables are
  inherited. Offline mode is on.
- **The scratch root is never under the home folder.** Skills and context
  files are also found by walking from the project up to its Git root, so a
  project in Windows' `%TEMP%` (inside the profile) loaded the developer's
  `~/.agents/skills`: they showed in `/` suggestions and made every plain
  project ask for trust. When the temp dir is inside home, the root goes to
  `<drive>\kc-parity`; `KNIGHTCODE_PARITY_TMP` overrides. A unit test fails if
  any ancestor of the project holds `.agents/skills`, `.claude/skills`,
  `AGENTS.md` or `CLAUDE.md`, and every ordinary scenario asserts that no trust
  card appears.
- The faux app server simulates missing `gh` for PR creation. The fixture
  keeps `PATH` intact so Git and other tools stay available.
- The scratch Git global config has a fixed identity for the desktop's own
  commits. Fixture commits made by the tests use fixed dates.
- The project contains a fixed README; scenarios add fixed files. Agent settings
  select `faux-e2e/faux-e2e`. Opt-in extras: the examples/mcp-app counter as a
  user MCP server, and a user extension whose commands raise each dialog kind
  and a declarative view (with `ask_user` enabled).
- Desktop preferences select light or dark explicitly, a 14px UI, 12px code,
  Arial UI/content fonts and Courier New code font, with translucency off.
- The four projects use exact content sizes: 1280×820 and 800×700, light/dark.
  Device scale is 1. Locale is en-US, timezone UTC and reduced motion is on.
- Terminal fixtures use Command Prompt on Windows and sh elsewhere, with a
  fixed prompt and cleared screen. No personal shell profile is required.
- Electron is closed before the scratch tree is removed, including after
  failures. Native quit confirmation is answered only during teardown.

## Capture rules

`capture` changes only run-dependent text and incidental focus; no ordinary
control or error is hidden and production styles are untouched.

- Text nodes are rewritten before the screenshot and kept rewritten by a
  mutation observer until it is taken (React re-renders a time mid-capture
  otherwise): scratch paths become `<fixture>`; clock times `12:00 PM`;
  archived dates `Jan 1, 2026, 12:00 PM`; turn durations `1s`; the desktop's
  own commit hashes `0000000`; version numbers `0.0.0`. Masks are not used
  for these because dialog backdrops blur the changing glyphs into neighbors.
- Only the preview address (an ephemeral port) is masked.
- Animations are disabled and the caret hidden. A focused button outside a
  dialog or menu (left over after its menu or dialog closed) is blurred,
  because focused buttons grow tooltips after a delay; then `capture` fails if
  any tooltip is showing. Dialogs that focus their close button first get a
  deliberate focus (Cancel, Run, confirm) from the test.
- Toasts dismiss after 5 s. Scenarios that show one hold the dismiss timers
  from the test and release them explicitly, so each screenshot has a fixed set.
- Streaming is captured at fixed points: a reasoning block streamed for
  several seconds (the running status shows its heading), and a turn that
  waits for Stop. Partially streamed reply text is never captured.

The platform is part of each baseline path:
`apps/desktop/test/parity/baselines/<platform>/<theme-size>/<screen>.png`.
Do not use Windows images as macOS/Linux expectations. Fonts, native chrome,
terminal shells and rasterization still require a same-platform environment.

## Coverage

Every group of the specification §10 behavior matrix has baseline screens.
The rightmost column is what screenshots cannot settle or the faux fixture
cannot reach; those stay behavior gates of the slice named in
[inventory.md](inventory.md) and are not claimed here.

| Matrix group | Screens (per project) | Left to the owning slice |
| --- | --- | --- |
| Startup, reconnect, windows, history | `home`, `server-reconnecting`, `server-reconnected`, `second-window`, `navigation-back`, `window-after-reload` | Native window controls, failed-server banner (five exits), offline-provider states (S4/S9) |
| Projects and thread list | `sidebar-collapsed`, `sidebar-pinned`, `sidebar-unread`, `thread-menu`, `thread-rename`, `thread-forked`, `settings-archived-populated`, `archived-delete-confirm`, `thread-delete-confirm`, `thread-deleted` | Native context menus, keyboard list navigation (S4) |
| Composer | `home-draft`, `palette`, `palette-filtered`, `composer-permissions`, `composer-full-access-confirmation`, `composer-model-picker`, `composer-file-suggestion`, `composer-command-suggestions`, `composer-add-menu`, `composer-attachment`, `composer-pasted-image`, `composer-queued`, `composer-steered`, `turn-running`, `turn-stopped` | Drag-and-drop, thinking/mode pickers (the faux model has no reasoning levels), a second provider mid-draft, IME (S5) |
| Transcript | `thread`, `thread-find`, `tool-completed`, `turn-thinking`, `thread-after-thinking`, `declarative-view`, `background-command` | Older-history paging, scrolling, render-count profiling (S5) |
| Requests | `approval`, `approval-denied`, `request-question`, `request-question-answered`, `request-select`, `request-confirm`, `request-input`, `request-editor`, `feedback-toast`, `mcp-app-approval`, `mcp-app-tool-confirmation` | Stale replies (S5) |
| Git | `git-commit`, `git-commit-message`, `git-committed`, `git-committed-generated`, `git-commit-detached`, `git-create-branch`, `git-branch-created`, `git-switch-branch`, `git-switched`, `git-pull-request`, `git-pull-request-form`, `git-pull-request-no-remote`, `git-pull-request-gh-missing`, `git-push-failed`, `git-push-retry`, `git-push-retry-failed` | Signed-in gh (draft/ready PR, returned URL), ambiguous write outcome, remount mid-write (S7) |
| Workspace | `workspace-new-worktree`, `workspace-base-branch`, `workspace-handoff`, `thread-in-worktree`, `worktree-actions-menu` | Handoff execution both ways, 250 ms preflight timing, refusals vs transport loss, environments, missing-worktree restore (S7) |
| Files and diffs | `file-tree`, `file-tab`, `changes-panel`, `changes-hunk-expanded`, `file-tab-changes`, `file-tab-saved` | Discard dialog (races the 3 s autosave), open externally, diff comments (S7) |
| Terminals and preview | `terminal`, `terminal-after-thread-switch`, `terminal-after-reload`, `terminal-exited`, `preview` | Shell menu (lists the host's shells), resize, preview annotations (S7) |
| MCP Apps | `mcp-app-inline`, `mcp-app-side-panel`, `mcp-app-full-screen` | Isolation is unchanged code, checked by the existing E2E (S7) |
| Settings | `settings-01`…`settings-12`, `settings-persisted-general`, `settings-persisted-appearance`, `settings-persisted-worktrees`, `settings-mcp-populated`, `settings-plugin-install`, `settings-plugin-trust`, `settings-plugins-installed`, `settings-shortcut-recording`, `settings-values-*` (9 per project), `project-trust`, `project-trust-deferred` | Provider sign-in/out (needs real accounts; not recordable here). `settings-values-*` (recorded on the pre-S8 build) cover the remaining General, Appearance, shortcut, Configuration, Tools and Worktrees values |
| Native and quit | `settings-12` (About) | Updates, quit while running (existing E2E answers the native dialog) (S9) |

`composer-pasted-image` writes a PNG to the system clipboard (the desktop
reads pastes from it through main), so a run replaces the developer's
clipboard contents.

## Behavior observed while recording

These are current behaviors the baselines now record. They look like defects
and should be fixed separately, before or after migration, with the baselines
updated in that change and the reason stated.

- After "Commit and push" commits and the push fails, the open card keeps its
  pre-commit status: it still shows the old +/- totals and disables Push (it
  last saw the branch level with its upstream), so the push cannot be retried
  from the card. Reopening the card reads the status again and Push works
  without a second commit. (`git-push-failed`, `git-push-retry`.)
- After the app server is killed and restarts, the reopened thread reports
  "This thread is open in another KnightCode process" with Fork it / Retry: the
  dead server's session lock is treated as live. (`server-reconnected`.)
- In a file tab opened from the Changes panel (showing its comparison),
  pressing the tab's own "Hide changes" crashes the view: "This view hit an
  error. Path does not exist: "Changed files/src/example.ts"". Not baselined
  (a crash is not a parity target). The same error also appears intermittently
  without that button: after opening a changed file from the Changes panel,
  closing the panel and opening a file from the tree. The edit/save flow
  therefore runs in its own thread with no Changes panel history.
- A reloaded window starts at Home, and the thread's terminal region is closed
  when the thread is reopened; toggling it shows the same terminal with its
  output (the process lives in main). (`window-after-reload`,
  `terminal-after-reload`.)

## Verification record

Windows 11 (10.0.26200), 2026-11-12, at `f4e10b2d3`:

- Recorded: 22 scenarios × 4 projects = 88 runs, 424 images (106 per
  project), with `--update-snapshots=missing` on empty baseline folders.
- Verified: a fresh, unchanged `bun run test:parity` passed all 88 runs with
  zero changed pixels (7.4 min).
- Reviewed: every light-wide image was inspected by eye for wrong states
  (loading placeholders, leaked tooltips, unnormalized times, developer paths)
  before the other three projects were recorded.
- Desktop unit suite: 164 passed, 7 skipped (includes 4 fixture isolation tests).
- Existing Electron E2E suite (uses the extended faux server): 12 passed.
- Desktop and root type checks: passed.
- Earlier record runs exposed and fixed: a developer-skills leak, a missing
  `fd`, version text from release bumps, timing-dependent tooltips, React
  rewriting normalized times, toasts expiring mid-capture, a crash-prone
  Changes-panel path, and a scratch path inside an input value.
- One startup failure in about 260 launches over the session: the renderer
  loaded its bundle but `#root` stayed empty and nothing reached the trace. Its
  cause is not established. Main's stdout/stderr and every renderer's console
  are now attached to each test (`electron-output-N`); retries stay disabled.
- Native macOS/Linux: not executed. Later slices follow.

### S1 — registry and built-in path

Windows verification after merging `main` (`ca48eaf14`) as `c69294b70`:

- Post-merge, unchanged build: 88/88 parity runs passed, zero changed pixels
  (8.2 min). Its first run passed 86/88: the Home composer contained unexpected
  typed text (`make`, 886 changed pixels), and a Git branch poll could not
  resolve HEAD during branch creation. These were not the known empty-root
  symptom. A full unchanged rerun passed; neither product code nor baselines
  were changed to resolve them.
- S1 app-server staging (`--platform=win32 --arch=x64`) and `bun run package`:
  passed. The palette's Quick actions and the toast presenter now use the
  public registration path; server/recovery banners remain host-owned.
- S1 `bun run test:parity`: **88/88 passed, zero changed pixels** (8.5 min),
  without a retry or baseline updates. All 424 expected images are unchanged.
- `bunx vitest --run`: **185 passed, 7 skipped**, across 37 files (one skipped).
  New coverage includes ordering, atomic duplicate/version rejection,
  per-set/per-registration abort and disposal, cleanup after errors, provider
  selection, public controller/store integration and the import boundary.
- `bun run test:e2e`: **14/14 passed** (36.6 s), including contribution ownership,
  public notification posting, render failure, fallback and recovery. The
  existing suite ran through a temporary launcher with scratch HOME/temp/config
  and offline settings, using the existing fixture environment. The separate
  client-rendered registry fixture is not an external artifact loader test.
- Root and desktop `bun run check-types`: passed. `bun run lint:extensions`,
  changeset validation and whitespace checks: passed.
- No real provider calls, native macOS/Linux runs or external extension loading.
  Provider preference persistence/settings, consent and authored CSS remain
  later-slice gates. See [registry.md](registry.md) for the S1 contracts.
- Review was a self-review; no independent reviewer tool was available.

### S4 — layout, navigation, thread list, home and title bar

Windows verification after S3 (`206be8558`) merged with main (`156fcb434`):

- The five structural built-ins now register synchronously through the public
  SDK; `store.ts` remains the implementation. The import audit passes with no
  exceptions.
- Focused unchanged-baseline screens passed before the full run: light-wide
  `home, retained draft, command palette and sidebar` reported 1/1.
- S4 verification counts are recorded in
  [layout.md](layout.md#verification).

#### Registry review follow-up

- Fixed two review findings: promise-returning setup could publish partial
  registrations, and abort listeners could invoke commands during disposal.
- Added five regression tests. The three async-setup tests failed before the
  setup guard; the two disposal tests failed before revocation was reordered.
  The registry suite then passed all 16 tests.
- Full desktop unit suite: **190 passed, 7 skipped**. Root and desktop type
  checks, import lint, changeset validation and whitespace checks passed.
- Windows server staging and desktop packaging passed. Electron E2E passed
  **14/14** (1.2 min), using the same isolated fixture launcher.
- The first comparison passed 86/88 (8.8 min). Light-narrow `palette.png`
  selected Keyboard shortcuts instead of New thread (30,522 pixels changed).
  Dark-narrow `git-commit-message.png` showed +1/-1 counts absent from its
  baseline (36 pixels changed). Neither was an empty-root startup failure.
  Failure artifacts were retained; the same build was rerun with no code,
  fixture or baseline changes.
- The unchanged rerun passed **87/88** (8.4 min). Both previous failures passed,
  but light-narrow `git-pull-request-form.png` omitted +0/-0 totals present in
  its baseline (41 pixels changed). No baseline was updated. The full zero-diff
  gate remains **not passed**; Git total readiness is inconsistent at capture.

### S5 — composer, conversation, requests and contextual commands

Windows verification on 2026-11-17 after S4 (`4c77893e1`) and the required
origin/main merge (`287f1e69b`):

- Windows server staging and `bun run package`: passed. Shipped SDK declarations,
  portable read models and author guide have the same SHA-256 values as source.
- Full `cd apps/desktop && bun run test:e2e`: **25/25 passed** (2.0 min).
  The three real-loader S5 cases cover the shipped contenteditable/action/message
  examples, native consent, UTF-16 edits, focus/caret, popup staleness, locks,
  plain-text/image paste, mixed image/file drop, configured keys and suggestion
  precedence, IME/provider deferral, attachments, stale handles/callbacks,
  queue/steer/stop, single hosts/listener, and request presenter recovery.
- Plain `cd apps/desktop && bun run test:parity`: **88/88 passed, zero changed
  pixels** (8.9 min), light/dark and wide/narrow. No baseline, fixture, mask,
  threshold or retry policy changed. No outer E2E isolation wrapper was used.
- Root and desktop type checks, zero-exception extension import audit, generated
  API/example check, changeset self-check and whitespace check: passed.
- Full desktop units: **245 passed, 7 skipped**, across 43 passing files and one
  skipped file. Focused CLI docs/models/artifact/authoring tests: **29/29 passed**.
- `bun run test:profiler`: passed in a real isolated Electron renderer. With 30
  completed turns, one live turn and 80 deltas, S4/current each recorded **160
  commits per turn and 160 composer commits**. Browser probes also verify plan
  and steered-message replacement and explicit item contexts. Durations are
  diagnostic only; no performance tolerance hides extra commits.
- Self-review found and regression-tested unchanged selection-report renders,
  Windows newline offsets, attachment/IME revision races, delayed thread-start
  navigation, stale request replies and mixed-drop ordering. No independent
  reviewer tool was available.
- See [composer.md](composer.md) for boundaries, decisions and the runnable
  profiler. Native macOS/Linux execution and S6 backend epochs remain outside
  this slice.
