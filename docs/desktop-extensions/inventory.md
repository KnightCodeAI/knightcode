# Desktop extension migration inventory

Baseline after the S0 main merges: `f4e10b2d3` (Windows; desktop and app-server
source unchanged since `3e5cd40c3`).
Specification: `docs/superpowers/specs/2026-11-03-desktop-extension-api-design.md`.
Plan: `docs/superpowers/plans/2026-11-12-desktop-extension-api-plan.md`.

This is a map of existing behavior, not a list of implemented extension APIs.
Paths below are relative to `apps/desktop/src/` unless stated otherwise.
The existing renderer store remains the host implementation; migrating markup
without exposing its behavior does not complete a surface.

## Surface map

| Surface | Current implementation | Public boundary to implement | Slice |
| --- | --- | --- | --- |
| Application layout | `renderer/builtins/layout/`; `renderer/extensions/structural.tsx` | Named layout provider; public surface composition, host-owned current-view boundary and recovery layout | S4 |
| Window chrome | `renderer/builtins/title-bar/`; `main.ts`; `main/host.ts` | Title-bar provider; finite mediated menu/window/update/zoom intents | S4 |
| Navigation | `renderer/builtins/navigation/`; `renderer/extensions/controllers.ts`; store history | Navigation provider/controller, pages including hidden destinations, revision-qualified startup visibility hints | S4 |
| Sidebar | `renderer/builtins/thread-list/`; `renderer/sidebar-model.ts` | Thread-list provider, shared accessible rows, metadata/status/action slots, project/thread facades | S4 |
| Home | `renderer/builtins/home/`; `renderer/extensions/home-support.tsx` | Home provider and ordered sections; setup/trust remain host-owned | S4 |
| Thread header | `renderer/builtins/thread-header/`; `renderer/extensions/conversation.tsx`; shared thread-action controls | Header provider, row/title/status/action slots, explicit identity/title/action services | S5 |
| Conversation | `renderer/builtins/conversation/`; `renderer/extensions/conversation.tsx`; `thread-view.tsx`, shared Markdown and `renderer/turns.ts` | Item renderers and message actions; explicit history/find/scroll/copy services; diff/preview/MCP engines remain platform capabilities | S5 |
| Composer | `renderer/builtins/composer/`; `renderer/extensions/composer-root.tsx`, `composer-behavior.tsx`, `composer-controller.ts`; store drafts | Revisioned root/controller, replaceable adapters, seven contribution hosts, shared IME/keys/paste/drop/submit/queue behavior and SDK-only pickers | S5 |
| Git/workspaces | `renderer/builtins/workspace/`; `renderer/extensions/workspace.ts`; app-server `desktop-operations.ts`, `git-actions.ts`, `workspaces.ts` | Explicit-checkout reads/actions, shared operation records, native ambiguity journal and non-replaceable recovery | S7 |
| Requests | `renderer/builtins/requests/`; `renderer/extensions/conversation.tsx`; store response guards; app-server approvals/dialogs | Replaceable presenter inside host ordering/recovery; exact-head, explicit-thread replies; server retains authority | S5 |
| Live extension tab | `renderer/components/thread-view.tsx`; shared registry/surface hosts | `experimental_registerPanelTab`, explicit thread context and epoch-owned RPC/settings/event facade | S6 |
| Backend/data | `packages/cli/src/app-server/desktop-extensions/` | Real jiti backend, coordinated revision/epoch, schema-checked RPC and explicit scoped persistence | S6 |
| Side panel | `renderer/extensions/panel.tsx`; `thread-view.tsx`, `changes.tsx`, `files-panel.tsx`, `file-tab.tsx` engines | Public tabs/file openers, code/diff providers, existing canonical file drafts and save/discard confirmation | S7 |
| Preview | `renderer/components/preview.tsx`; `main/preview.ts`; `renderer/drag.ts` | Preview intents/hosts and annotations; keep guest isolation | S7 |
| MCP Apps | `renderer/components/mcp-app.tsx`; `renderer/mcp-app-bridge.ts`; `main/mcp-apps.ts` | Public host, not a replacement for the isolated MCP App runtime | S7 |
| Bottom region | `renderer/components/terminal.tsx`: BottomRegion; `main/terminals.ts` | Region provider and mediated terminal controller; mount does not own process | S7 |
| Background output | `renderer/components/background-terminals.tsx`; store background snapshots | Background output tabs/status and explicit stop intent | S7 |
| Settings | `renderer/builtins/settings/` (one file per page, shell and column providers); `renderer/extensions/settings-host.tsx`; `packages/cli/src/app-server/configure.ts`, `config.ts`, `plugins.ts` | `experimental_registerSettingsSection` (declarative backend-setting fields or custom React), `settings`/`settingsNav` providers, allowlisted settings requests; the Extensions page mounts built-ins only | S8 (done) |
| Commands | `renderer/components/palette.tsx`; `renderer/builtins/commands/index.ts`; `renderer/keys.ts`; `shared/keybindings.ts` | Quick actions and contextual composer/thread commands use the registry and explicit controllers; key matching remains configurable | S1/S5 |
| Appearance | `renderer/appearance.ts` (derivation); `renderer/builtins/settings/appearance.tsx`; `renderer/app.tsx`: useTheme; `main/host.ts` | `experimental_appearance` intents, `experimental_registerThemePreset`, `experimental_ThemeScope` previews followed by owned portals and overlays | S8 (done) |
| Feedback | `renderer/builtins/feedback/index.tsx`: Toasts, ZoomBanner; `renderer/app.tsx`: ServerBanner (host-owned); `renderer/store.ts`: toast state | Notification controller, `experimental_useZoom`, feedback provider; server/recovery notices stay host-owned | S1/S8 (done) |
| App overlays | `renderer/components/dialog.tsx`, `popover.tsx`, `menu.tsx`, `tooltip.tsx`; `extensions/surface.tsx` | Owner/revision-aware portal host; overlay roots and `experimental_Portal` carry the nearest theme preview | S2/S8 (done) |
| Content scripts | No application extension equivalent yet | Owned activation/disposal lifecycle; not a sandbox | S2 |
| Recovery | `renderer/app.tsx`: ViewBoundary, ServerBanner; native menus in `main.ts` | Non-replaceable extension settings, fallback notices, native safe-mode restart | S2 |

## State and authority

- `renderer/store.ts` holds renderer state and orchestration. Public controllers
  must be facades, not a second store or unrestricted selector API.
- `shared/host-protocol.ts` defines desktop state and validated main operations.
  `main/state.ts` persists `desktop-state.json`; terminal/process lifetimes stay
  in main. The SDK must not expose the raw host bridge.
- The app server retains approvals, project trust, file/Git/workspace writes,
  settings validation and session ownership. Drawing a request does not grant
  permission to answer another request or skip server checks.
- Drafts, attachments, selected tabs, terminal processes and Git operation state
  must survive provider remounts. Frontend disposal is not thread disposal.

## Existing settings pages

Every page needs screenshots and persistence checks, not only a settings-shell
screenshot. IDs come from `renderer/routes.ts`; labels from SettingsNav:

| ID | Label | Additional state to preserve |
| --- | --- | --- |
| general | General | Send key, queue/steer, notifications, close confirmation, auto-archive |
| appearance | Appearance | Light/dark/system, custom colors/fonts, advanced sizes/materials |
| models | Models & accounts | Default model, provider sign-in/out, reasoning options |
| archived | Archived threads | Search/filter, unarchive and permanent delete confirmation |
| shortcuts | Keyboard shortcuts | Capture, conflict handling, reset and persistence |
| configuration | Configuration | User/trusted-project scopes, reset and per-model overrides |
| tools | Tools | Enabled tools, defaultTools, web providers, codemode/classifier settings |
| mcp | MCP servers | User/project scope, exposure, enable/add/remove |
| extensions | Extensions & skills | Resource selection and origin/scope; separate native consent |
| plugins | Plugins | Installed/Marketplace, trust, details, updates/import/uninstall |
| worktrees | Worktrees | Branch prefix, setup environments, selection and persistence |
| about | About | App/server versions, logs and update state |

## Behavior verification map

Existing `test/e2e/app.e2e.ts` covers real Electron prompting/approval, project
trust and Not now, Stop, archive, quit confirmation, terminal commands, file
tree/tab retention, diff scope, preview, MCP App confirmation and plugin trust.
It does not establish screenshot parity or complete specification §10.

The parity suite records stable same-platform images for its named states;
[parity.md](parity.md#coverage) maps each specification §10 group to its
screens and to what remains for the owning slice.
Missing images must fail comparison; never silently generate a baseline during
a normal test run. Baselines can be recorded only before product migration.

The following remain explicit acceptance groups even if a screenshot exists:

| Group | Required checks beyond a static screenshot | Gate |
| --- | --- | --- |
| Startup/navigation | Offline/reconnect, history, multiple windows, profile and chrome | S4/S9 |
| Thread list | Projects/recents/pin/unread, rename/fork/archive/unarchive/delete, menus and keyboard | S4 |
| Composer | Attachments/paste/drop, mentions/commands, model/mode/thinking, Enter settings, queue/steer/Stop, retained drafts | S5 |
| Alternate editor | Contenteditable plus a second extension's controls, IME, selection/caret/focus, locks, revision races, stale disposer | S5 |
| Transcript | Streaming/grouping/thinking, older history, search/scroll, views and tool/message rendering; render-count profiler | S5 |
| Requests | Approval, confirmation, select/question/text/editor, cancel and stale replies | S5 |
| Git | Status/default-base/detached HEAD, branch/create/checkout/switch, commit/generated/include-unstaged, push and PR variants | S7 |
| Git recovery | Branch/commit/push partial success, missing/unauthenticated gh, ambiguous write outcome, retry without duplicate writes | S7 |
| Workspace | Local/worktree/base/environment/carry changes, both handoffs, latest 250ms preflight, focus/revalidation, refusals vs transport loss, warnings/restoration | S7 |
| Operation lifetime | Remount/reload/multiple windows during writes; retained outputs, no stale mutation | S7 |
| Files/diffs | Scope, hunk expansion, file drafts/save/discard, preview tabs, open externally, diff comments | S7 |
| Terminals/preview | Shell/resize/reattach/thread switch/reload/kill, background output, annotations | S7 |
| MCP Apps | Isolation, tool approval and fullscreen preserved | S7 |
| Settings | Every page/value/scope, trust, accounts, resources, plugins, keyboard and appearance persistence | S8 |
| Native chrome | About/updates/window controls and quit with running threads | S9: quit-with-running covered by the existing E2E; native window controls and updates not executed |
| Extension runtime | Real external loader, consent, CSS ownership/portals, provider choice/fallback, safe mode, binary-only authoring, preview switch, compatibility ranges and updates | S2/S3/S9 (matrix in the S9 ledger) |
| Coordinated revisions | Incompatible two-window RPC, preparation failure, drain timeout, stale bindings, restart and post-commit recovery | S6 |

S7's implementation boundaries are described in [workspace.md](workspace.md).
Do not mark a group complete on the strength of a renderer unit test. Record
Electron, image-comparison, packaged-binary and native-platform results
separately. Windows results do not establish macOS/Linux parity.
