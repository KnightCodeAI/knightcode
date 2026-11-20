# Settings, appearance and feedback (S8)

Settings is a built-in extension (`renderer/builtins/settings/`). Its
`settings` provider draws the page shell and its `settingsNav` provider draws
the sidebar column. Each page body registers as that page's first section,
with `order: -1000`. External sections follow in `order`, then owner order.

## Sections

A declarative section lists `fields` (switch, select, number). The host
renders them with the same renderer as the built-in settings.json pages, and
reads and writes them through the owner's epoch-bound backend app settings
(`backend.md`, "Settings and storage"). Secret settings are not readable from
the frontend. A section from an extension without a backend shows a notice.
It never falls back to a second store.

`scopes` (default `["app"]`) lists where a schema section can save values. With
more than one, the host adds a Scope row: the app, each sidebar project, and
each project's unarchived threads. The choice becomes an explicit backend
selector (`{ scope: "project", cwd }` or `{ scope: "thread", cwd, threadId }`),
never the window's selection. A thread is keyed by its project, also when it
runs in a worktree. Rows show the inherited value (thread > project > app >
default) and a write lands only in the chosen scope, on the same S6 store.
Project and thread scopes need a trusted project, as every backend data
context does; an untrusted one shows the server's refusal in the section.

A custom section supplies `experimental_render`. Each section mounts at its own
ownership root, so a crash stays inside its error boundary.

## Recovery and trust

The Extensions page is the recovery route. It always mounts the built-in shell,
the column and only `builtin.*` sections, whatever provider is chosen. The
native extension list (`extensions/settings.tsx`) stays host code. Built-ins
reach it as `experimental_settingsServices().experimental_NativeExtensions`.
Project trust uses `project/trust/*` through the settings allowlist, unchanged.

## Requests

`experimental_settingsServices().experimental_request` accepts only the
generated `SettingsRequests` methods. The host checks the method name before
sending anything, and a retired activation's calls reject.

## Appearance

`experimental_appearance()` is the only path for app-wide theme changes. It
wraps the existing preference store and derivation in `renderer/appearance.ts`.
Customizations from extensions pass the same field validation as an imported
theme string. Presets appear in the Theme menu for their theme, and applying
one replaces that theme's customization. `experimental_ThemeScope` sets
`data-theme` and derived tokens on a subtree. Overlay roots (`usePortalOwnership`)
and `experimental_Portal` containers copy the nearest scope's theme. Without a
scope they inherit the window theme live. Extension CSS still cannot redefine
`--kc-*` tokens.

## Feedback

The built-in feedback provider draws toasts and the zoom banner. Zoom state is
followed from host start, so a replacement or remounted presenter reads the
current level. The server-state banner, the unknown-operation notice and the
extension recovery notice remain host-owned and are not replaceable.

Reference artifact: `10-settings`. Unit tests are in
`test/renderer/settings-extensions.test.ts`, and the real-loader case is in
`test/e2e/settings-extensions.e2e.ts`.
