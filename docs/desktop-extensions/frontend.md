# Desktop frontend loading (S2)

S2 loads explicit `knightcode.desktop.frontend` entries in each window.
Backend entries remain rejected until S6. Arbitrary Tailwind compilation remains
S9 work. See `packages/cli/docs/desktop-extensions-preview.md` for the author
contract and examples.

## Loading and replacement

1. The app server discovers explicit entries in configured packages and the
   dedicated desktop extension directories. Project discovery requires project
   trust. It does not infer entries from ordinary CLI extensions.
2. It validates the local module graph without evaluating it. Only relative
   modules and the published shared runtime imports are accepted. Real paths
   must remain inside the extension. Unsupported imports, backend entries and
   invalid CSS produce diagnostics before execution.
3. It stages content-addressed artifacts under the agent directory. The revision
   covers the modules, validated CSS, assets and runtime contract. Direct names
   in CSS have separate keyframe, property, layer and font namespaces.
4. Electron asks for native frontend consent. A normal grant pins a revision;
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
6. The renderer loads CSS and the module's inert declaration before preparing
   a registration candidate. A successful synchronous setup commits once. The
   previous activation remains live until then. Failed imports, CSS, setup,
   duplicate IDs, versions and async setup leave that activation intact.

An explicit reload reruns setup and remounts contributions even if the revision
is unchanged. Browser ESM caching still applies to the unchanged module graph;
this does not promise to reevaluate module-level side effects. A changed
revision gets a distinct module graph.

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
rewriting the saved choice. Broader structural surfaces, their loading grace
period and boot cache remain S4 work.

## Recovery

Host-owned controls show inventory, consent state and diagnostics, reload or
disable an owner, revoke consent and choose a provider. The settings entry,
recovery notice and native View menu are not replaceable contributions.

`--safe-mode` skips external staging and frontend execution. Main refuses
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
separately. The +2 ms guard is for row selection; whole-list invalidation has
shown a larger cost and is not claimed free. macOS/Linux native packaging and
the complete S9 CSS/utility acceptance matrix have not been run in S2.
