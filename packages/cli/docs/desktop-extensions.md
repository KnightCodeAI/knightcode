# Desktop extensions (preview)

API version 1 is experimental. This guide, the [generated API inventory](desktop-api.md),
[portable declarations](desktop-sdk.d.ts), skill and examples ship with the CLI and
Desktop's bundled binary. They match the installed release, not the latest website.

## Authoring

Run `knightcode desktop-ext --help` for commands. No npm install, localhost
frontend server, separate Node/Bun runtime, or downloaded compiler is needed
with Desktop's bundled executable. Quote its absolute path when it is not on
PATH; it is beside the shipped `docs/` directory. The npm CLI can validate
prebuilt ESM; TSX validation uses Desktop's bundled executable.

```sh
knightcode desktop-ext new my-notice --json
knightcode desktop-ext validate /absolute/path/to/my-notice --json
knightcode desktop-ext reload --json
knightcode desktop-ext status --json
```

`new` creates a frontend TSX/CSS package under the current agent directory's
`desktop-extensions/` folder and refuses to overwrite a directory. Its result
locates the installed guide and examples. Edit those files, then validate.
`validate` checks the complete declared module/CSS graph, supported imports,
retired or unsupported SDK aliases and asset containment without running setup.
It writes no consent and cleans its temporary validation artifacts.

Approve the source through Settings before it can execute. With explicit
**Trust development reloads**, saving any file in that package (including a
nested module or stylesheet) requests reload after a short debounce. Pinned
revision approvals never opt into watching. Disabling, revoking trust, safe
mode and server shutdown stop watches.

`reload` requests activation; it does not wait for rendering or prove success.
Read `status` afterward. It contacts the already-running desktop app server(s)
for this agent directory, never a fresh server with empty diagnostics. JSON is
`{ servers: [{ pid, safeMode, extensions }], unavailable: [] }`. Each extension
includes source, approval/enabled/dev flags, candidate revision/error and bounded
per-window diagnostics. Compare diagnostic revisions with the candidate; a load
error may mean the old working UI remains active. No running desktop or an
unreachable discovered server returns exit code 1. Validation/usage errors also
return 1 and `--json` emits `{ error }`. Successful commands return 0.

Controls use bounded, authenticated loopback TCP messages with a random token in private local
`desktop-control/` discovery files. They expose status/reload, never approval.
They accept no HTTP or browser-origin requests and bypass HTTP proxies.
They are not a remote API; only processes using the same agent directory should
use them. A stale file from a crashed server is reported as unavailable; after
checking that instance has stopped, remove only its discovery file.

## API

<!-- surface: feedback -->

Native frontend extensions add palette commands and feedback contributions.
A user can explicitly select a feedback provider. Other application surfaces
and backend entries are not exposed yet. The API is experimental.

These extensions share the app renderer, React, and the DOM. They can inspect
conversations and change application UI. Error boundaries are not a security
sandbox. Only approve code you trust. Session-extension trust, project trust,
and Claude/Grok plugin trust do not grant native frontend consent.

## Load and manage

Put a local package in
`~/.knightcode/agent/desktop-extensions/<name>/`. Installed native KnightCode
packages can also declare a desktop entry. Nothing is inferred from filenames.
Project packages require both saved project trust and native approval.

```json
{
  "name": "my-desktop-extension",
  "type": "module",
  "knightcode": {
    "desktop": {
      "frontend": "./app.tsx",
      "styles": ["./app.css"]
    }
  }
}
```

Open Settings → Extensions & skills. For a project package, select its scope.
The native desktop section appears when a package is found. **Trust frontend**
opens a native confirmation showing the source and entry kind:

- **Trust this revision** permits only the validated content revision. Source
  changes require review again.
- **Trust development reloads** also permits future edits at that source.
  A repository cannot grant itself this permission.

Consent is stored in the agent directory's `desktop-extension-consent.json`,
not in project settings. **Reload extensions** rereads configured sources and
updates every open window independently. A failed preparation keeps that
window's previous working registration and stylesheet set. Disable and revoke
trust take effect without ending threads or terminals. Development-approved
sources are watched; other sources require an explicit reload and new consent
when their pinned revision changes.

Installing or reloading a provider never selects it. **Feedback provider**
sets the app default, stored in `desktop-state.json`. A separate window choice
survives renderer reloads but ends when that window closes. Missing or failed
providers fall back to the built-in without deleting the selected preference.
The recovery notice offers management, switching back, and disabling the
selected extension. That notice and its settings are host-owned.

To recover when the renderer cannot respond, use the native View menu's
**Restart without extensions**, or launch the desktop executable with
`--safe-mode`. Restarting still asks before interrupting running threads.
Safe-mode startup skips external frontend execution and artifact staging. It does
not revoke saved trust. A normal restart enables approved extensions again.

## Imports and lifecycle

The desktop's bundled Bun compiler accepts explicit `.ts`, `.tsx`, `.jsx`,
`.js` and `.mjs` module paths. No package manager or downloaded compiler is
needed. Node-only app-server clients can stage prebuilt ESM; TSX requires the
bundled desktop compiler.

Use top-level imports. Relative modules must exist inside the same package.
Remote imports, private workspace imports, CommonJS loading and inline imports
are unsupported, including private type imports. The shared runtime provides:

- `@knightcodeai/cli/desktop`
- `react`, `react-dom`, `react/jsx-runtime`
- `radix-ui`, `@pierre/diffs`, `@pierre/trees`, `typebox`

Do not bundle a second React or these host singletons. Staged scripts and
assets are served from registered `app://ext/<owner>/<revision>/` paths, not
arbitrary files or remote URLs.

```tsx
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";

export default defineDesktopExtension((app) => {
  app.experimental_registerSlot({
    id: "notice",
    surface: "feedback",
    experimental_render: () => <span className="notice">My contribution</span>,
  });
});
```

Setup is synchronous. It stages declarations and cleanup callbacks. Do not
start active services or mutate application state during preparation. Imports
and setup are trusted JavaScript; arbitrary side effects cannot be rolled back.
Use `experimental_onDispose` for owned resources, registration abort signals
for asynchronous actions, and captured command contexts for thread targets.
A stale callback cannot invoke a disposed command or publish late registrations.

`experimental_registerCommand` adds an ordered palette entry; its label and
availability receive a captured window/thread context, and its action receives
an abort signal. `experimental_registerSlot` adds an ordered feedback node.
`experimental_registerProvider` offers a named feedback replacement, selected
only by the user. IDs are owner/local; duplicate IDs reject the candidate set.
`defineDesktopExtension` defaults to API version 1; unsupported versions reject
activation. `experimental_onDispose` cleanup is idempotent and continues after
a throwing callback. Individual handles expose `dispose()`.

`experimental_controllers()` provides the current supported intents: new-thread
screen, add project, sidebar visibility, settings/shortcuts, thread-bound terminal
toggle/create, and notification/dismissal. These are mediated host actions, not
raw protocol access. `experimental_useToasts` reads host-owned notifications.
`experimental_Button`, `experimental_Icon`, `experimental_KeybindingKeys` and
`experimental_Portal` share the host's theme, bindings and React runtime.
The generated declarations list the exact types and accepted values. Do not
use unprefixed registration methods or a top-level `experimental_notify`;
use `experimental_controllers().experimental_notify`.

The host owns thread state, toasts and provider preferences. Frontend component
state belongs to that window/mount and resets on reload; it is not transcript
storage. Cleanup cannot undo arbitrary side effects. There is no extension
storage/settings or backend RPC API yet. Layout/sidebar/home controllers,
composer replacement, file/message renderers, Git/workspace controllers, custom
settings and appearance providers are later slices, not available APIs.

## Styles

Declare authored CSS explicitly. Local quoted `@import` rules are flattened;
local PNG/JPEG/GIF/WebP and WOFF/WOFF2 assets are staged with the revision.
Every stylesheet must load before registrations are published.

```css
.notice { color: var(--kc-text); font-family: var(--kc-font-ui); }
:scope .notice:hover { color: var(--kc-text-secondary); }
```

Rules are wrapped in an owner/revision `@scope` that stops before a foreign
contribution. Owned roots restore the host's inherited presentation. Use
`experimental_Portal` for menus and popups outside the surface tree; it retains
original ownership, theme tokens, CSS and mount lifetime. Raw unowned portals
under `document.body` are unsupported.

The supported CSS grammar is intentionally limited. It rejects document-wide
`html`, `body`, `:root` and unscoped universal selectors; sibling escapes,
functional/relational selectors, CSS escapes, nesting, remote imports and
non-staged resource URLs. Use complete owned selectors instead. Conditional
`@media`, `@supports` and `@container` rules are supported. Keyframe, font,
layer, property-registration and custom-property names are revision-namespaced.
Use distinct, non-keyword names for local animations and fonts. Direct names
can be referenced across the declared stylesheet set. Indirect animation or
font names carried in custom-property values are not supported.

Published read-only tokens are `--kc-text`, `--kc-text-secondary`,
`--kc-text-tertiary`, `--kc-font-ui`, `--kc-font-code`, `--kc-font-content`,
`--kc-size-ui`, `--kc-focus` and `--kc-selection`. Extension CSS cannot redefine
`--kc-*` tokens. Arbitrary host Tailwind classes are not an API. The utility
compiler is deferred; use authored classes absent from the host bundle.

## Examples and diagnostics

The shipped `examples/desktop-extensions/06-failure/` demonstrates a failed
provider and a failed activation. `08-owned-css/` demonstrates authored CSS,
shared React state and an owned portal. Copy a whole example directory to the
local package directory above, review it, then approve it through Settings.

Settings shows source, revision, consent, enabled state and per-window
load/render diagnostics. The app-server methods `desktopExtension/list`,
`desktopExtension/set`, `desktopExtension/reload` and
`desktopExtension/diagnostic` expose the same frontend-only inventory and
bounded diagnostics. `desktopExtension/changed` tells connected windows to
reread it. Backend RPC remains unavailable.

## Testing and recovery

Start with the shipped examples or the generated package. Validate first,
activate only with consent, exercise the command/contribution in Desktop, then
read status. Deliberately throw in setup or a render function to test diagnostics
and fallback; restore the source and validate/reload again. Test disable, owned
portal cleanup, light/dark appearance and a second window. Static validation
cannot prove React rendering, synchronous setup, registration uniqueness, or
runtime API-version compatibility. The real loader checks these on activation.

The build verifies generated reference/declarations, guide coverage for every
SDK surface, and the module/CSS graph of every shipped example. Maintainers run
`bun packages/cli/scripts/generate-desktop-api.ts --check`; omit `--check` to
regenerate after an SDK change. Error messages refer to sections in this guide.
Use Settings, the host fallback notice, or native safe mode for recovery. Never
edit consent files to bypass review.
