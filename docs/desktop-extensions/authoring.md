# S3 authoring verification

The authoring CLI, guide, generated API inventory/declarations and desktop-only
skill are implemented. S6 adds coordinated backend RPC, scoped data and the
page/live-panel example; see `backend.md` and the shipped author guide.
S3 is complete: the parity gate passes 88/88 (see the verification record).

## Packaged authoring proof

`apps/desktop/test/e2e/extension-authoring.e2e.ts` copies the Windows packaged
app outside the checkout. It starts the real bundled app server and a scripted,
loopback-only chat-completions fixture. No paid provider is used.

The app and its agent tools run with OS tools and Git on PATH, but no Node or
Bun. The test checks both missing runtimes with `where.exe`. The agent reads
the installed skill, guide, inventory and declarations, creates and validates
TSX/CSS, sees its contribution, introduces a setup failure, reads the live
per-window error, fixes the source and sees automatic reload publish the fix.
The final status reports an active revision.

Native consent is supplied by the test harness, not granted by the agent or
CLI. Existing native-consent and recovery tests remain in the Electron suite.
The test uses renderer CDP because the packaged app disables the main-process
Node inspector. No fuse or sandbox setting is changed. This tests a copied
packaged distribution, not the operating-system installer.

The proof caught a real blocker: the bottom-right recovery alert covered
approval buttons. The alert now sits below the title bar at the top-right;
the user can approve the commands the agent needs to inspect and repair a failure.

Recorded artifacts from the Electron run:

- `apps/desktop/test-results/extension-authoring.e2e.ts-22d81--fixes-a-frontend-extension/packaged-authoring.png`
- `apps/desktop/test-results/extension-authoring.e2e.ts-22d81--fixes-a-frontend-extension/agent-tool-results.json`

## Listing cost

Run `bun packages/cli/scripts/measure-desktop-skill.ts`. At this source path:

| Measure | Characters | Estimated tokens |
| --- | --- | --- |
| One listing entry | 314 | 79 |
| Entry plus the shared first-skill wrapper | 618 | 155 |
| Added to non-desktop sessions | 0 | 0 |

These are measured formatted strings and KnightCode's characters/4 estimate,
not a model-specific tokenizer count. Entry cost is about 7% of the measured
1,100-token core floor; if this is the only skill, its shared wrapper makes the
estimate about 14%. The skill body and guide are read on demand, not added
to every prompt. An installed path can have a different length.

## Local controls and validation

Status and reload use bounded, token-authenticated loopback TCP messages.
HTTP clients were unsuitable: Bun 1.3.3 applied environment proxies even to
its node:http shim and ignored the attempted fetch proxy bypass. Direct TCP
keeps the local token off HTTP proxies. Discovery files are user-local; no
approval endpoint exists. Offline/stale peers and safe mode are reported.

Validation does not execute extension imports or setup. It checks the module,
CSS and asset graph and rejects known retired/unsupported imported members
with replacement text. Activation still checks registration sets and rendering.

Both build scripts check guide coverage, the literal SDK API version, exact
generated assets and the shipped example graphs. They also type-check every
reference example against the shipped declarations; a regression test proves
that a stageable TypeScript assignment error fails packaging. Root type checks
include the same standalone example project. Generated `.d.ts` files are excluded
from manual formatting. Backend declarations and their opaque context brand are
published in `desktop-backend-sdk.d.ts`; the asset gate validates both SDKs and
all frontend/backend example graphs. Native-kind consent gates execution.

## Verification record

- Root and desktop type checks passed.
- CLI focused and prompt regression suites: 85 passed across 10 files, including
  Node prebuilt-ESM validation, Node/Bun clients of the same control service,
  non-desktop prompt behavior and example type-check failures.
- Desktop unit suite: 203 passed, 7 skipped; import audit passed.
- API asset/example check, portable declaration/example type check, formatting,
  changeset validation and whitespace checks passed.
- Windows app-server compilation and Forge packaging passed.
- Rebuilt after the example type-check gate; fresh full Electron suite: 19 passed
  (1.5m), including the packaged agent proof.
- Standard `cd apps/desktop && bun run test:parity`: first 84 passed, 4 failed.
  All four were `terminal-exited.png`: cmd's startup banner prints the Windows
  build, which an OS update moved from `10.0.26200.9711` to `10.0.26200.9974`.
  The scene now runs `cls` before `exit`, so no OS version is captured; only
  those four images were re-recorded.
- The next full run exposed a second capture race (recorded earlier as the
  "Git-stat timing variation"): the commit and pull request cards load their
  change totals after opening, and the S0 `git-commit-message` baselines had
  caught them empty. The Git scene now waits for the totals before capturing;
  `git-commit-message` and `git-push-retry` were re-recorded in all four
  projects (settled `+1 -1` and `+0 -0`). That scene then passed three
  consecutive runs.
- Final full parity: 88 passed, 0 failed (7.8m). No mask or threshold changed.

Use the standard command for parity, not the outer E2E isolation launcher. That
launcher changed editor discovery and temporary output-path lengths, producing
two Open-in header failures and two one-pixel faux token-meter failures. Both
focused cases and all four projects passed unchanged under standard invocation.
The older generic Electron E2Es still require the launcher's temp/home isolation;
the session launcher's parity branch now retains the standard environment.
Final parity logs and all four expected/actual/diff sets are retained under
`.superpowers/sdd/2026-11-12-desktop-extension-api-plan/verification/s3-standard-parity/`.

Initial test-run issues were retained in the execution ledger: incomplete temp
isolation caused ancestor-resource trust prompts; the new watcher raced an
older CSS-failure test's staging step; the existing style-performance guard
intermittently reached or exceeded its strict +2 ms limit. Temp isolation and
staging order were fixed; the affected tests then passed in isolation without
changing the performance
threshold. The CSS candidate is now staged and broken outside the watched
source before the source edit can trigger activation.

Review is self-review only; no independent reviewer tool was available. Native
macOS/Linux, the Windows installer and model-specific tokenization were not
run. No merge, commit, push or release is part of this change.
