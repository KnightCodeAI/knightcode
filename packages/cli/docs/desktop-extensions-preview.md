# Native desktop extensions (preview)

The authoritative, version-matched guide is now [Desktop extensions](desktop-extensions.md),
including authoring commands, generated declarations, diagnostics and watching.

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
sources now reload on save; see the authoritative guide for the authoring CLI.

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
reread it. Backend RPC remains unavailable. Use `knightcode desktop-ext --help`
for the authoring CLI and the current guide for automatic watching.
