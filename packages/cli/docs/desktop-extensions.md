# Desktop extensions (preview)

API version 1 is experimental. This guide, the [generated API inventory](desktop-api.md),
[portable declarations](desktop-sdk.d.ts), [backend API](desktop-backend-api.md),
[backend declarations](desktop-backend-sdk.d.ts), skill and examples ship with the CLI and
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
It writes no consent and cleans its temporary validation artifacts. The JSON
revision uses the same canonical source identity as Desktop review and status;
unchanged files therefore report the same revision.

Optional TypeScript checks are separate from validation. The shipped examples'
`tsconfig.json` maps both SDK imports to `docs/desktop-sdk.d.ts` and
`docs/desktop-backend-sdk.d.ts`, not checkout source. When copying an example,
adjust those two `paths` entries to the installed CLI's `docs/` directory. An
external type checker also needs React's types, TypeBox, and declarations for
any UI libraries the example imports.
Loading or validating the extension does not require that type checker.

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

Native frontend extensions add palette commands, ordered contributions, pages
and named feedback or structural providers. Installing a provider never selects
it. All new members retain the `experimental_` prefix. Optional backend entries
run once per app-server process with its OS permissions and require separate
native-kind approval.

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
      "styles": ["./app.css"],
      "app": ">=0.1.0"
    }
  }
}
```

Two optional manifest fields state compatibility: `apiVersion` (an integer,
default 1) and `app` (a semver range of desktop app versions, for example
`">=0.2.0"`). A package that declares another API version, or whose range
excludes the running app, is refused whole with a diagnostic such as
"Requires KnightCode desktop >=0.2.0; this is 0.1.2". Neither its frontend nor
its backend is staged, approved or loaded. If an earlier version is running,
it stays live until you restart or remove it, like any failed update.
`desktop-ext validate` checks `apiVersion`. It cannot check the `app` range,
because it does not know which desktop will load the package; the running
desktop checks it when it lists the package, and Settings shows the refusal.

Installed packages update through `knightcode update`. A trust-this-revision
approval does not follow an update: the new version shows "Source changed" until
you review it. Approving it, or a development approval that follows edits,
switches every window to the new revision together. Handles bound to the old
revision stop answering, and its backend stops before the new one starts.

Open Settings → Extensions & skills. For a project package, select its scope.
The native desktop section appears when a package is found. Its **Run native
desktop extensions** switch is off by default: while off, no extension frontend
or backend code runs, even an approved one, and reload and development watches
do nothing. Turning it on asks for native confirmation; turning it off stops
external extensions in every window. If a backend cannot finish shutdown, the
app server must restart before that package can run again. The choice is stored in
the agent directory's `desktop-extension-preview.json`. Review can validate
and stage an inert copy even while the preview is off. It does not load code
or grant a serving lease. The native confirmation shows the source, revision,
and entry kinds:

- **Trust this revision** permits only the validated content revision staged
  when the confirmation opened. If the package changes before you confirm,
  approval is refused and nothing is trusted. A later source change requires
  review again.
- **Trust development reloads** also permits future edits at that source.
  A repository cannot grant itself this permission.

Consent is stored in the agent directory's `desktop-extension-consent.json`,
not in project settings. **Reload extensions** rereads configured sources and
coordinates one revision/epoch decision across every open window. Removing a
package folder stops its frontend and backend the next time a window reads the
inventory (opening Settings → Extensions & skills, or Reload extensions). A failed
preparation retains the old matching frontend/CSS/backend pair everywhere. Disable and revoke
trust take effect without ending threads or terminals. Development-approved
sources are watched; other sources require an explicit reload and new consent
when their pinned revision changes.

Installing or reloading a provider never selects it. **Feedback provider**
sets the app default, stored in `desktop-state.json`. A separate window choice
survives renderer reloads but ends when that window closes. Missing or failed
providers fall back to the built-in without deleting the selected preference.
The recovery notice offers management, switching back, disabling the
selected extension, and **Dismiss**, which hides it until another failure
occurs. That notice and its settings are host-owned.

To recover when the renderer cannot respond, use the View menu's
**Restart without extensions** (on Windows it is in the app's own View menu
in the title bar), or launch the desktop executable with
`--safe-mode`. Restarting still asks before interrupting running threads.
A window that does not close within a few seconds is closed forcibly, so a
wedged extension cannot block the restart.
Safe-mode startup does not stage or run extensions for execution. It does not
revoke saved trust. A normal restart enables approved extensions again.

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
arbitrary files or remote URLs. The artifact cache keeps three unleased
historical revisions per owner. Live review, preparation, backend and native
serving leases protect their revisions across processes; a later staging pass
prunes older unleased files.

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
only by the user. IDs are owner/local and must be unique across every
registration kind: a slot and a command, or a panel tab and a settings section,
cannot share an ID. A duplicate rejects the whole candidate set at activation;
`validate` does not detect it.
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
storage. Cleanup cannot undo arbitrary side effects. Backend settings and
storage use explicit scopes described below. File engines and workspace mutation
controllers are described in the workspace section. Settings sections and the
appearance API are described in the settings section.

## Backend RPC, settings and data

Declare `desktop.backend: "./server.ts"` alongside the optional frontend entry.
Neither half is inferred. Adding a backend requires fresh native approval,
including for development-approved packages. It permits trusted code with the
app server's OS permissions, not a restricted permission sandbox. Backends use
`@knightcodeai/cli/desktop-backend`, `typebox`, Node built-ins and package-local
modules. Mutable third-party graphs, require/inline imports and remote imports
are rejected. Backend source is private and never served to the renderer.
See `02-backend/` for a complete page and live side-panel example.

Use `experimental_defineDesktopBackend(app => { ... })` for synchronous,
inert declarations. `experimental_registerRpc` declares a local ID, server-owned
`read`/`write` kind, TypeBox parameter/result schemas and an async-capable
`experimental_handle(params, signal)`. Both boundaries are checked. Services
start in `experimental_onActivate`; register pause/resume hooks for producers
and return cleanup or use `experimental_onDispose`. Activation runs once for
the shared process, not once per renderer/thread.

Frontend commands can capture `experimental_backend()`; React components use
`experimental_useBackend()`, which returns a handle only after the matching
backend/frontend ready decision. Call `experimental_call({ id, params, result },
args, signal)` with shared schemas. Results are `ok` with `value`, `error`
with `message`, `cancelled`, `disconnected`, or `outcome-unknown`. A cancelled
or lost admitted write may have completed: read/reconcile state, never blindly
retry. Handles never retarget another epoch. `experimental_subscribe({ id,
schema }, listener, signal)` checks events and exact bindings and returns an
owned disposable. Reconnect subscriptions explicitly after an update.

`experimental_setting({ id, schema, default, secret? })` and
`experimental_storage({ id, schema })` create backend value handles. Omitted
context means app/user data. Resolve a project/thread context explicitly with
`await app.experimental_context({ scope: "thread", cwd, threadId }, signal)`;
project selectors omit threadId and use scope `project`. Paths must be absolute,
existing and trusted; thread IDs must belong to that project. Captured contexts
retain that identity or refuse after cancellation, trust revocation or identity
change. They never follow the selected thread. Pass the activation-owned token
to `experimental_get(context)` or `experimental_set(value, context)`;
do not serialize tokens over RPC.

Settings precedence is thread > project > app/user > declared default. Storage
has no inheritance. Records are owner-namespaced under the app server's
`desktop-extension-data/`, outside repositories and transcripts. Frontend
`experimental_settings(selector?, signal?)` reads only public values;
`experimental_setSetting(id, value, selector?, signal?)` validates writes and
refuses secrets. Secrets stay server-side at every scope. Window-local
provider/layout preferences retain their existing native/session storage.

Preparation validates saved scopes without mutation. After gating new actions
and waiting for admitted calls/IME input to drain, the host commits one epoch,
disposes old services and publishes prepared frontends. A drain timeout resumes
the old pair; post-commit renderer failure falls back only in that window.
Failed backend activation/teardown disables all windows rather than reviving
disposed services. Server restart requires a fresh handshake. Persistent writes
are not rolled back; incompatible migrations need an explicit recovery plan.

`experimental_registerPanelTab({ id, label, experimental_render })` adds an
owned tab beside the thread's built-in tabs. It receives explicit thread context
and uses the same registry, CSS, gate, boundary and disposal lifetime as a page.
Disable/removal returns to the built-in tab. This does not replace the file,
preview, terminal or workspace engines.

## Structural providers and navigation

<!-- surface: layout -->
<!-- surface: navigation -->
<!-- surface: threadList -->
<!-- surface: home -->
<!-- surface: titleBar -->

Register a provider with a local ID and one of these surfaces. Settings offers
an app default and a per-window override for each. Use
`experimental_SurfaceHost` to compose navigation, threadList, home or titleBar,
and `experimental_Content` for the current view. The title bar is outside the
layout by default; do not mount it twice. Recursive surface replacement falls
back. Recovery settings always use the built-in layout, and fallback notices
and native recovery controls stay outside replaceable surfaces.

Built-ins register before first paint. A selected external surface gets a
neutral skeleton for at most 300 ms, then the built-in if still unavailable.
A late ready provider may mount afterward. The preference is retained.
Presentation-only startup hints cache app choices and owner/revision-qualified
hidden rail entries; window overrides use window-local session storage.
Invalid data, changed revisions, disabled sources and safe mode invalidate
visibility hints. A cache never grants trust or execution.

`experimental_registerPage({ id, label, hidden, experimental_render })`
declares a page. Hidden pages have no rail entry but remain reachable through
`experimental_controllers().experimental_openPage("owner/id")`. Pages share
the host's back/forward history. Disposing a page shows an unavailable notice
without redirecting a captured action to another page.
`experimental_hideNavigation({ id, target: "home" | "profile" })` hides only
those ordinary rail entries. Recovery cannot be hidden this way.

`experimental_useNavigation` reads the view, sidebar visibility and history
availability. `experimental_useThreadList` reads projects, threads, pins,
unread markers and sidebar options. They subscribe to the existing host store,
not an extension-owned copy. Controllers accept explicit thread IDs for
open/pin/rename/archive and project paths for removal. New boolean-returning
intents return false when declined; window command failures report a notice.
No controller replaces the renderer store or bypasses server approvals.

`experimental_windowCommand` accepts only the declared finite command union.
Main validates each request and retains native quit/update confirmations.
Use `experimental_useUpdate` and the finite `experimental_shellServices`
for update/profile/help, sidebar presentation, formatting and configured key
matching. Neither exposes arbitrary protocol calls or the raw host bridge.
`experimental_controls` and `experimental_icons` provide shared accessible
controls. Native caption buttons remain native-owned.

<!-- surface: homeSection -->
<!-- surface: threadRowMetadata -->
<!-- surface: threadRowStatus -->
<!-- surface: threadRowActions -->

Register additive slots for ordered home sections, thread row metadata,
statuses and actions. `experimental_Slots` mounts them with their
original owner and revision; row callbacks receive `context.row` and its
explicit thread/cwd. Ordering remains order, owner, then registration order.
Home setup/trust prompts are host-owned, not replaceable sections.
`experimental_ThreadRow({ threadId })` keeps the standard native context menu,
rename/delete dialogs, pin/archive controls, unread/status marks, keyboard
activation and all row contribution slots. Use it in alternate lists rather
than duplicating those behaviors.

Copy `04-thread-list/` to try the shared rows. Copy `workspace-layout/` and
explicitly select both its layout and thread-list providers to group existing
threads by cwd and show a breadcrumb. It deliberately does not create
workspaces, perform Git mutations, or introduce a second tab/draft model.

## Composer editor transactions

<!-- surface: composer -->
<!-- surface: composerActions -->
<!-- surface: composerBanners -->
<!-- surface: composerChips -->
<!-- surface: composerAddMenu -->
<!-- surface: composerSendMenu -->
<!-- surface: composerSuggestions -->
<!-- surface: composerPopups -->
<!-- surface: threadHeader -->
<!-- surface: threadHeaderActions -->
<!-- surface: threadHeaderStatuses -->
<!-- surface: threadHeaderTitle -->
<!-- surface: threadHeaderRow -->
<!-- surface: requests -->
<!-- surface: messageActions -->
<!-- surface: transcriptItem -->

`experimental_composer({ threadId })` or `experimental_composer({ cwd })`
returns a controller for that explicit draft. `experimental_useComposerDraft`
subscribes to the same store-owned record. Drafts contain text, image paths,
revision, and reported selection/focus/composition state. Content revisions
advance when text or image paths change, not when selection or focus changes.
All offsets use UTF-16 positions in normalized plain text. Replacement strings
normalize Windows CRLF and CR line endings to LF before calculating the cursor.

`experimental_attachComposerEditor(target, adapter)` attaches one editor and
returns `{ status: "mounted", mount }`, `busy` during the current editor's
composition, or `unavailable` for a retired host or invalid adapter range.
The adapter reads text/selection/focus/composition, applies text
and selection without echoing a transaction, focuses the editor, and supplies
a caret rectangle in viewport coordinates. It must report normalized text and
valid ranges. Dispose the mount on unmount. Host teardown also revokes it.

Use `mount.experimental_report(revision)` for editor transactions, passing the
revision last applied or synchronized by that mount, not an arbitrarily newer
revision from another writer. Native reports can merge attachment-only changes
when their last-applied text still matches canonical text. Captured programmatic
ranges remain strictly revision checked. Use `experimental_sync()` to
apply the canonical snapshot after another draft writer changes it. Sync
refuses to overwrite an active composition. Insertion refuses a stale editor
selection, even when the caller passes the latest canonical revision. A text
writer that retains its previous selection invalidates that selection; the
next editor report or explicit selection restores it.

Controller range replacement, insertion, selection and focus commands return
`applied` (with revision), `stale` (with current revision), `busy`, `locked`, or
`unavailable`. Missing selection never implies an end-of-document insertion.
`experimental_focus` preserves selection; `experimental_focusEnd` deliberately
moves it. `experimental_lock(signal)` blocks editor reports and programmatic
commands until disposed, the owner signal aborts, or the host ends. Locks from
other owners remain active. Stale mount reports/disposers cannot affect a
replacement editor. Adapter initialization errors release the failed mount
before propagating to the caller.

`experimental_ComposerRoot` owns behavior and the selected `composer` provider.
The app mounts it for an explicit thread or new-thread project. A provider reads
`experimental_useComposer()` and renders `experimental_ComposerFrame`, optionally
passing its own editor. The frame includes the standard controls and every
contribution host. `experimental_TextareaEditor` is the default adapter.

A custom editor calls `experimental_useComposerEditor(adapter)` inside that root
and marks its editable element `data-kc-editor`. The hook owns mount/report/sync
cleanup; the root captures editor input, selection, focus, composition and image
paste. The adapter remains responsible for normalized plain text, DOM range
mapping and any editor-specific native insertion behavior. Do not add a second
send shortcut handler. Unhandled keys remain available to the editor.

For a custom frame, mount `experimental_ComposerContributions` once for each
host: `actions`, `banners`, `chips`, `addMenu`, `sendMenu`, `suggestions`, `popups`.
Missing or duplicate hosts, duplicate adapters and render failures fall back to
the built-in. Contribution roots and owned portals keep their original owner,
ordering and styles, including inside another owner's composer.

Root behavior dispatches editor composition before configured shortcuts.
Suggestion navigation/accept/dismiss precedes send; composing Enter cannot send.
Text/selection commands return `busy` during composition, and a provider change
waits for the editor's composition end. Composition in a popup does not defer
an unrelated editor change. Input locks and submission availability also gate
send. `experimental_submit` and `experimental_stop` target the live root;
`applied` on submit means admission and draft clearing, not backend completion.
Failed new-thread input is retained without overwriting newer typing. Saved
root callbacks cannot start new actions after their root ends.

Copy both `01-composer-action/` and `03-contenteditable/`, approve them, then
explicitly select the latter's composer provider. The second owner's controls
exercise selected-range insertion, popup staleness, locks, focus-end and caret
anchors while the editor is genuinely contenteditable. Its previous-editor
observer demonstrates that a retired disposer cannot detach the replacement.
Text, image paths and usable selection remain canonical across provider changes.

## Thread, transcript and request presentation

A `threadHeader` provider receives an explicit `context.thread`.
`threadHeaderTitle`, `threadHeaderRow`, `threadHeaderStatuses` and
`threadHeaderActions` slots retain additive ownership. Shared thread controls
keep rename, menus, confirmations and workspace identity host-mediated.

`experimental_registerItemRenderer` selects an ordered renderer for
`context.item`; its availability callback should select supported item kinds.
`experimental_registerMessageAction` adds ordered message controls. Recursive or
failed item replacement uses the ordinary renderer. Copy `05-message-renderer/`
for an assistant renderer and explicit copy action. Portable domain types ship
in `desktop-models.ts` next to the declarations; no private protocol import is
needed.

`experimental_conversationServices()` supplies finite explicit-thread reads and
intents, shared Markdown/activity controls, history, find and scroll behavior.
Composer send/alternate/stop and thread find/scroll/copy commands use the command
registry. `experimental_runCommand(id, context)` returns false when unavailable;
pass the intended composer/thread context rather than reading a later selection.
Contextual commands do not add duplicate global palette entries.

A `requests` provider receives `context.request`. Keep that exact object when
answering through `experimental_answerApproval`, `experimental_answerDialog` or
`experimental_answerQuestions`. They return false for a different thread, an
out-of-order, cancelled or already-answered request. The server still validates
all replies. The host owns request ordering and the **Use default request
controls** recovery action, so a failed or unusable presenter cannot remove the
standard approval/dialog controls.

<!-- surface: terminal -->
<!-- surface: code -->
<!-- surface: diff -->

## Workspace, files and terminal

Pass `context.workspace` into `experimental_workspaceServices().experimental_git(target)`
or `experimental_panelServices().experimental_panel(target)`. The target names the
thread, its checkout and its project. A retained controller does not act on
the window's later selection. A retired activation cannot start new work.

Use `experimental_useGit` for status, totals, branches and operation state.
Read the operation's completed steps and outputs before offering recovery.
Retry resumes the same operation; it does not repeat confirmed steps. The
built-in dialogs label that retry explicitly and use its saved options, not
newly edited fields. Dismiss the incomplete action before requesting a new
local-only commit or a different PR mode. A retry refuses a changed branch or
HEAD, including workflows that skipped committing. An
unknown outcome requires checking the repository and remote first. The
server keeps operation state across renderer and provider reloads during its
lifetime. These workflows do not roll back completed Git writes.

Use `experimental_useHandoffCheck` before offering a move between checkouts.
The host debounces branch edits and rechecks on focus. A transport error is
not a server refusal. The server checks again before moving the checkout.

`experimental_registerPanelTab` adds a tab. A named
`experimental_registerFileOpener` can open an intent in its owner's tab.
Opening a file without an opener ID uses the built-in editor. File saves
use the tab's draft and the last known mtime. Dirty-tab confirmation stays
in the host.

The `code`, `diff`, and `terminal` providers are opt-in. The terminal
controller operates on existing native processes; changing providers does
not kill them. Preview and MCP App intents use the existing guest hosts,
not a new bridge or sandbox. See examples `07-workspace` and `09-file-viewer`.

<!-- surface: settings -->
<!-- surface: settingsNav -->

## Settings and appearance

`experimental_registerSettingsSection` adds a section to an existing Settings
page. Most sections only declare a title and `fields`: switches, selects and
numbers bound to the owner's backend settings (see the backend guide's
settings section). The host renders and saves them through the epoch-bound
backend, so the frontend never sees secret settings. Add
`scopes: ["app", "project", "thread"]` (any subset; the default is app only)
to let the user pick where values are saved: the host adds a Scope row listing
the app, each sidebar project and its threads. Rows show the inherited value
and a write changes only the chosen scope. Project and thread scopes need a
trusted project. A section without a
backend shows that it needs one. For anything else, give
`experimental_render` instead; lay it out with `experimental_settingsControls()`
(Row, Card, Section, fields) so it matches the built-in pages. Sections are
ordered by `order` then owner. The Extensions page is the recovery route: it
shows only built-in sections, and its layout cannot be replaced.

`experimental_settingsServices()` gives the built-in pages' reads and writes:
desktop preferences, keybindings, accounts and sign-in, archived threads, and
a fixed list of settings app-server methods. Any other method is refused. The
`settings` and `settingsNav` providers replace the page shell and its sidebar
column; they are opt-in like every provider. Mount
`experimental_SettingsSections` in a replacement shell to keep every section.

Application-wide theme changes go through `experimental_appearance()`: mode,
per-theme customization (accent, background, foreground, fonts, contrast,
sidebar material), sizes, diff markers and pointer cursors. Each intent returns
false once the activation is retired. `experimental_registerThemePreset` adds a
named customization that users can apply; registering one changes nothing.
`experimental_ThemeScope` previews a theme in a subtree. Dialogs, menus,
popovers, tooltips and `experimental_Portal` content opened inside it follow
the preview; outside one they follow live theme changes. Extension CSS still
cannot redefine `--kc-*` tokens.

The `feedback` provider draws toasts and the zoom level
(`experimental_useZoom`). Server-state, unknown-operation and extension
recovery notices stay host-owned. See example `10-settings`.

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
`--kc-*` tokens. Arbitrary host Tailwind classes are not an API, and no utility
compiler ships; use authored classes absent from the host bundle.

## Examples and diagnostics

The shipped `examples/desktop-extensions/06-failure/` demonstrates a failed
provider and a failed activation. `08-owned-css/` demonstrates authored CSS,
shared React state and an owned portal. Copy a whole example directory to the
local package directory above, review it, then approve it through Settings.

Settings shows source, revision, consent, enabled state and per-window
load/render diagnostics. The app-server methods `desktopExtension/list`,
`desktopExtension/set`, `desktopExtension/reload`, `desktopExtension/preview/set` and
`desktopExtension/diagnostic` expose the same frontend-only inventory and
bounded diagnostics. `desktopExtension/changed` tells connected windows to
reread it. Renderer RPC uses only the epoch-bound SDK facade; raw runtime
protocol envelopes are refused by the native router.

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
