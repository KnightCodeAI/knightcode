# S1: registry and built-in path

This slice establishes the renderer registration path. It does not load
external artifacts. The loader, consent, CSS ownership, provider preference
storage and recovery settings follow in later slices.

## Files and boundaries

- `packages/cli/src/desktop.ts` is the public source SDK. It has only a
  type-only React import. Importing it neither reads the host nor activates
  an extension. The CLI root does not import it.
- `apps/desktop/src/renderer/extensions/registry.ts` owns window-local sets.
- `extensions/surface.tsx` mounts providers and additive slots, with a render
  boundary and `data-kc-owner` on each contribution root. The wrapper uses
  `display: contents` to preserve layout. Render failures use a separate
  built-in root, not the failed provider's ownership.
- `extensions/host.tsx` installs stable controller and UI bindings before
  registering `builtins/commands` and `builtins/feedback` synchronously.
- `renderer/store.ts` remains the only notification/domain state store.
  Presenter disposal does not clear notices or terminate a thread/terminal.

`defineDesktopExtension` is the inert declaration helper. Experimental SDK
symbols and registration/controller methods use `experimental_`. Data fields
such as `id`, `order`, `surface` and `apiVersion` describe declarations; they
are not stable API promises. The declaration helper keeps its specified name.

## Registration rules

Setup is synchronous. It stages commands, feedback slots and feedback
providers, plus cleanup callbacks. The host supplies the owner. Local ids
cannot contain `/`; published ids are `<owner>/<local>`.

The host validates the whole set before notifying subscribers. Duplicate ids
across registration kinds, invalid ids/orders, unsupported versions and setup
failure publish nothing. Failed setup releases its cleanup callbacks.
Reusing a live owner is rejected rather than replacing that owner's set.

Order is ascending `order` (default zero), owner id (ordinal comparison),
then registration order. Registering a provider does not select it. The
resolver accepts an explicit preference and a built-in id. Missing or
unavailable choices fall back without rewriting that preference. A rendering
failure also falls back; a failed additive slot does not remove other slots.

Each registration returns an idempotent disposable. Disposing one registration
aborts its signal and removes that entry. Disposing the set aborts its setup
signal and every registration signal, removes all entries, then runs cleanup
in reverse order. A throwing cleanup is reported and does not stop the rest.
Late registrations and calls through disposed command entries are refused.

Commands receive a captured context (thread id/cwd, new-thread cwd and sidebar
state) and an abort signal. Controllers never resolve a terminal target from
the window's later selection. Errors in availability, labels and execution
are contained by the registry. React render errors are contained by the
contribution boundary.

## Import audit

From `apps/desktop`, run `bun run lint:extensions`. The desktop unit suite also
runs the audit. It checks all source under `renderer/builtins/`, root
`examples/desktop-extensions/` and `packages/cli/examples/desktop-extensions/`.

Allowed bare imports are the desktop SDK and its testing entry, `react`,
`react-dom`, `react/jsx-runtime`, `radix-ui`, `@pierre/diffs`, `@pierre/trees`
and `typebox`. Relative imports must stay inside the same extension directory.
A root-level standalone file cannot import another extension beside it; use a
per-extension directory for multiple files. The check covers type imports and reexports. Inline loading, `require` and
symlinks are rejected. This is a code boundary check, not a sandbox for
trusted JavaScript. Babel's parser and AST walker are development dependencies
at the already-resolved versions; TypeScript 7's root export has no parser API.

## Checks

- `bunx vitest --run` in `apps/desktop`: registry, public controller/store
  integration, built-in markup and the import audit.
- `bun run test:e2e`: production quick actions/toast ownership and a separate
  React client fixture for provider failure, slot isolation and recovery. The
  fixture is not an external loader test; that remains an S2 gate.
- `bun run test:parity`: all 88 same-platform runs, with unchanged baselines.
- Root and desktop `bun run check-types`.

See [parity.md](parity.md) for the fixture recipe and verification record.
