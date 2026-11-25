# Git, workspace and panel boundaries

S7 exposes explicit checkout targets through the experimental desktop SDK.
The app server owns Git/workspace operation records; provider unmount does not
own their lifetime. Stages record confirmed outputs before proceeding. Retry
skips completed stages, including a checked no-change commit. PR failures with
an unconfirmed outcome require reconciliation, not replay.

The native router retains ambiguous operations if the server exits, including
their confirmed branch/commit/push outputs. Reloading the renderer cannot erase
that fence. A host-owned recovery notice asks the user to check the checkout
and remote before acknowledging it. This is not on-disk persistence across
quitting the desktop, automatic rollback, or exactly-once external writes.

The existing server checkout reservations, turn admission and repository locks
remain authoritative. The workflow adds project-level admission across windows.
It checks explicit checkout identity and confirmed branch/commit identity before
resuming. Handoff checks debounce at 250 ms, discard stale results, invalidate
on branch changes, and refresh on window focus. Transport failures are separate
from server refusal. Execution checks again in the server's existing handoff.

SDK-only Git/workspace dialogs live under `renderer/builtins/workspace`.
`components/git.tsx` retains the host summary/sources bridge and re-exports
those presenters. The public new-thread workspace choice feeds the existing
S5 submission path.

Panel controllers use existing tabs and file drafts; they are not a second
tab store. Named file openers route into an owner's panel tab with an explicit
file intent. Dirty-tab confirmation and mtime-checked saving remain host-owned.
Code/diff providers wrap the existing editor engine, including its edits and
annotations. Terminal providers use native process identities, not component
mount lifetimes. Preview and MCP App hosts keep their original isolated guest
runtimes, partitions, approvals, fullscreen and annotation behavior.

Reference artifacts: `07-workspace` and `09-file-viewer`. Unit and real-loader
coverage and serial gate results are recorded in the S7 ledger. Windows-only
evidence does not imply native macOS/Linux coverage.
