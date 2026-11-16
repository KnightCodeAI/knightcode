# Structural desktop providers (S4)

Built-in layout, navigation, thread list, home and title-bar presenters live in
`apps/desktop/src/renderer/builtins/<surface>/`. They register synchronously
through the public SDK before first paint. The import audit has no exceptions.
`store.ts` remains the state implementation; typed read hooks and intent
facades live in `renderer/extensions/controllers.ts` and `shell-bindings.tsx`.

## Boundaries

The layout composes named surface hosts and a host-owned current-view region.
Each surface has an explicit built-in ID and an independent app/window choice.
Installation and reload never choose a provider. Missing or failed providers
fall back without deleting the preference. Recursive surface replacement uses
the built-in. Extension management always uses the built-in layout, independent
of a selected external layout. Recovery notices and native safe-mode controls
remain outside all replacement surfaces.

The thread list retains project groups, recents, pins, attention/unread states,
search, folding, sorting, sizing, multi-selection, native context menus and
confirmation dialogs. Shared rows expose metadata, status and action slots at
the original contribution's ownership roots. Shared menu/dialog/tooltip roots
carry that same ownership through their existing overlay library; presence,
focus and keyboard handling stay with that library.

Home setup and trust prompts remain host-owned. Ordered home sections do not
replace them. The title bar invokes a finite typed command set through main's
validated operations; native caption controls and quit/update confirmations
remain native-owned. Hidden pages participate in store navigation/history but
do not add a rail entry. Disposing a selected page leaves a recovery notice.

Layout recovery can remount a composer. Draft text and image paths now belong
to the existing store so that remount does not erase them. S5 still owns the
editor adapter, revisioned selection, composition and contribution contracts.

## Startup hints

The versioned localStorage record contains app provider choices and hidden
ordinary rail IDs qualified by owner/revision. Window overrides use session
storage keyed by the native window ID. No cache contains code, trust grants,
thread text or native authority. Safe mode ignores both caches synchronously,
using a native preload fact before extension initialization.

A selected provider that is not ready gets a neutral skeleton until the
300 ms startup deadline, then the built-in. A late ready provider may mount.
Hidden rail entries do not expire at that deadline: doing so would flash Home
while a slow approved module is still loading. Authoritative inventory removes
hints for missing, disabled, unapproved or changed revisions; activation failure
removes that owner's hints. Successful publication replaces them. Malformed or
unknown-version stored data is ignored. Offline hints affect presentation only;
recovery remains reachable.

## Examples

`04-thread-list` replaces the thread list and uses shared rows to retain menus,
keyboard activation, confirmations and contributions. `workspace-layout`
offers two independently selectable providers: a layout with a breadcrumb and
a list grouped by each thread's existing workspace cwd. It performs no Git or
workspace mutations and introduces no second thread, draft or tab store.

See the [author guide](../../packages/cli/docs/desktop-extensions.md) for exact
experimental names and the generated declaration/example checks.

## Verification

Windows 11 (10.0.26200), 2026-11-15, at `156fcb434` plus this slice:

- Desktop unit suite: 214 passed, 7 skipped across 43 files. New coverage:
  controller mediation and refusals, drafts outliving presenter disposal,
  synchronous structural registration, page/hidden-navigation lifecycle,
  provider-surface rejection, and startup cache expiry/invalidation.
- Import audit: zero exceptions. Root and desktop type checks passed. Generated
  API inventory/declarations, guide coverage and every shipped example graph
  and type check passed.
- Electron E2E: 22 passed (1.5 min) against the packaged Windows build and the
  real faux app server. The three new tests cover shared-row menus/keyboard
  navigation/contributions, both example providers, a bounded skeleton then
  built-in fallback for a slow provider, a throwing title bar falling back, a
  retained preference, retained draft text across a layout swap, hidden pages
  in back/forward history, slot ordering/context, and clean safe-mode startup
  with no skeleton, script or stylesheet from external code.
- Standard `cd apps/desktop && bun run test:parity`: 88 passed (8.0 min) with
  zero changed pixels. No baseline, mask or threshold changed.
- Focused CLI desktop-extension and prompt suites: 54 passed across 7 files.
  Changeset section self-check and formatting passed.
- Electron behavior is covered; native macOS/Linux packaging and the S9
  acceptance matrix were not run.
