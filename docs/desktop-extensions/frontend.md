# Desktop frontend loading

S2 introduced explicit `knightcode.desktop.frontend` entries. S6 coordinates
frontend/backend revisions across windows; see [backend.md](backend.md).
An extension utility compiler is not shipped: S9 found no authoring need for
it (see the S9 ledger), so authored CSS and the published tokens remain the
styling contract. See
`packages/cli/docs/desktop-extensions.md` for the shipped author contract.

## Loading and replacement

1. The app server discovers explicit entries in configured packages and the
   dedicated desktop extension directories. Project discovery requires project
   trust. It does not infer entries from ordinary CLI extensions.
2. It validates the local module graph without evaluating it. Only relative
   modules and the published shared runtime imports are accepted. Real paths
   must remain inside the extension. Backend graphs capture local modules separately;
   only Node built-ins, the backend SDK and TypeBox are allowed bare imports. Unsupported imports and
   invalid CSS produce diagnostics before execution.
3. It stages content-addressed artifacts under the agent directory. The revision
   covers both module graphs, shared schemas, validated CSS, assets and runtime
   contract. Both graphs use one captured copy of each canonical source module. Direct names
   in CSS have separate keyframe, property, layer and font namespaces.
4. Electron asks for native consent for the exact frontend/backend execution
   kinds, including backend OS permissions. A normal grant pins a revision;
   the separate development choice permits later revisions. The consent file
   is not repository settings. Enabling cannot add an unapproved native kind.
5. Main validates the requesting window's current server connection and the
   enabled, approved owner/revision before acquiring an artifact lease. Each
   stylesheet lifetime has its own lease ID: a delayed release cannot revoke a
   newer acquisition of the same revision. Cancellation waits for a pending
   grant to release that specific lease and never starts its CSS afterward.
   `app://ext/` serves only declared files for acquired revisions, with explicit
   MIME types and desktop-origin CORS. Encoded separators, traversal, symlinks,
   undeclared files and unrelated origins are rejected.
6. The renderer loads CSS and inert declarations before acknowledging prepare.
   Failed imports, CSS, setup, duplicate IDs, versions and async setup retain the
   matching old pair in every window. After readiness, the host gates actions,
   drains admitted work/IME input, commits one backend epoch and publishes each
   frontend. A failed publisher is revoked in its window; failed backend start
   or old teardown disables the owner globally instead of reviving disposed code.

An explicit reload creates a fresh epoch, even for unchanged files. Module
edges and the SDK shim carry an activation nonce, so browser ESM cache cannot
reuse an obsolete facade. Module leases are per activation; stylesheet leases
remain per revision and retained roots. Imports are trusted code: reevaluation
and disposal cannot roll back arbitrary module side effects.

Disposal aborts owned work, revokes registrations before callbacks, removes
owned views and portals, and releases CSS and serving leases. A stale disposer
or a rejected command from a disposed activation cannot alter or report against
its replacement. CSS leases also cover still-mounted views during React's
unmount. Unreferenced staged cache files may remain on disk; cache presence
does not grant a serving lease or permission to execute them.

## Compiler and shared runtime

Desktop ships a Bun binary, not a requirement for an installed Bun, Node or
TypeScript toolchain. Staging uses its transpiler with classic JSX and an
explicit import of the host React singleton. The compiled Windows probe
identified a broken automatic-JSX helper in Bun 1.3.3; the classic output was
verified in the binary itself.

Main serves generated ESM shims for the published runtime modules. A generated
entry script reports the default export to the host. No renderer `eval`,
`blob:` module or Node API is required. Node-only app servers can stage prebuilt
ESM; TSX staging on Node is refused rather than downloading a compiler.

## Ownership and preferences

Authored CSS uses owner/revision `@scope` boundaries. A foreign owner or revision
is a scope limit and starts from a reset inherited base. Portals keep the
originating owner/revision and live theme tokens. Global definitions are
namespaced. The grammar rejects unsupported selectors, escapes and resources;
it does not claim to isolate arbitrary CSS. Custom-property indirection for
animation or font names is outside this grammar.

Main owns the app's provider defaults. Per-window overrides survive renderer
reload and end when that window closes. Ordinary renderer state writes cannot
erase app defaults. A failed or absent selected provider falls back without
rewriting the saved choice. Structural surfaces use the S4 300 ms loading grace and versioned startup
presentation cache. See [layout.md](layout.md).

## Recovery

Host-owned controls show inventory, consent state and diagnostics, reload or
disable an owner, revoke consent and choose a provider. The settings entry,
recovery notice and native View menu are not replaceable contributions.

`--safe-mode` skips external staging and frontend/backend execution. Main refuses
artifact acquisition in safe mode. The native restart action requests this
flag independently of renderer code. The real Electron test wedges an external
setup in an infinite loop, invokes the native menu in main and verifies process
exit and the safe-mode relaunch arguments. The test records the relaunch rather
than starting an unmanaged second application.

## Verification boundaries

The Windows tests use production Electron, a real app server and real staged
artifacts. Only the AI provider and native consent choice are fixture adapters.
The CSS test checks two owners with colliding class, animation, font and
registered-property names, nested foreign roots, host inheritance, portal theme
updates and failed-reload retention.

The 500-row benchmark reports row selection and whole-list invalidation
separately. It interleaves unscoped and scoped rounds and times 20 toggles per
round. Native `@scope` adds about 1.1x to row selection, which must stay under
1.5x. It roughly doubles a whole-list invalidation (about +1.7 to +2.1 ms on
Windows), so that path is bounded at under 3x the unscoped cost and under
10 ms; a `:has()` scope boundary measured 6.4x and fails. The S9 spec §11
matrix is in the S9 ledger. The macOS/Linux workflow
(`.github/workflows/desktop-extensions-native.yml`) is written but has not run.

## Preview switch

The **Run native desktop extensions** switch under Settings → Extensions &
skills is off by default. The app server enforces it: while off it stages no
artifact, prepares no backend, admits no activation, installs no development
watch and ignores reloads. Turning it off retires every live owner through the
coordinator in all windows; turning it on asks natively first. It is stored in
the agent directory beside consent, not in repository or desktop state.

## Compatibility and updates

A manifest may declare `apiVersion` and an `app` semver range. Main passes
its version to the app server (`KNIGHTCODE_DESKTOP_VERSION`). Discovery turns
an incompatible manifest into the entry's error before staging, so neither
half is approved or loaded. A running earlier revision stays live as for any
failed candidate. A package-manager update changes the content revision:
pinned consent asks again, and approval switches every window to a new epoch.
External activations cannot set project or plugin trust or `allowFullAccess`
through settings services; the built-in pages keep those decisions.
