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
It never falls back to a second store. Project- and thread-scoped declarative
fields are a later slice. Until then, use a custom section with the backend
client.

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
