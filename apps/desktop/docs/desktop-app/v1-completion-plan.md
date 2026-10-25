# Desktop v1 completion (S2b, S3, S4, D): implementation plan

Status (2026-10-23): draft v7, reviewed (see Review history). S2b implemented.
Written on `main` at
`5730595a1` (Phase C merged, #408). Each phase lands as its own PR from its
own branch off `main`; Phase D as one PR per slice. No commits are authorized
by this plan.

**Goal:** Finish the desktop app's v1 (desktop-shell.md section 19) and move
the terminal CLI onto the app server (architecture.md section 7), in four
phases run in this order:

| Phase | What it delivers | Needs |
| --- | --- | --- |
| S2b | Read-only file tabs, "Open in…" with detected editors, hunk expansion in the Changes pane, a handoff pre-check | `main` |
| S3 | An integrated terminal, a web preview with Annotate, MCP Apps (third-party UI) | S2b (the side panel's tabs) |
| S4 | Installers on Windows, macOS and Linux with the bundled binary, updates, a release workflow, end-to-end tests, the release hardening left over from C | S3 (node-pty must package) |
| D | The TUI on the app server, in-process, rendering from the same session events it renders today | S4 shipped |

**Architecture** (section 2, D1): built-in panes are native code in the app, and only
third-party UI runs sandboxed. The Changes pane stays the React component it
is. The terminal is `node-pty` in Electron main with xterm.js in the renderer.
The preview is a `<webview>` tag on a per-thread partition. Third-party UI
comes from MCP servers as MCP Apps, drawn in a sandboxed iframe on its own
origin and bridged to the app server. The GUI-extension model of the old
desktop-shell.md section 12 (`desktop.json`, `kc-ext://`, a `utilityProcess`
extension host, `@knightcode/desktop-sdk`) is dropped. Packaging is Electron
Forge, unsigned until certificates exist, with signing wired to secrets that
can be filled in later. Phase D keeps `interactive-mode.ts` as close to the
reference engine as possible: the TUI talks to an in-process app server through
a session facade that carries the session's own events, so its renderers do
not change.

**Spec:** desktop-shell.md (amended with this plan: sections 1.3, 2, 3, 6.3,
9.7-9.9, 11.1, 12-19) and architecture.md (sections 4.4, 7, 8.3, 9, 10, as
amended). "§" below means desktop-shell.md; "arch §" means architecture.md.

---

## 0. Mandatory reading

Before any phase:

1. `AGENTS.md` in full: "The Core Constraint", Code Quality, Commands,
   Dependency and Install Security, Git, Changelog.
2. desktop-shell.md §2, §3, §4, §9, §13-§19 (as amended by this plan).
3. architecture.md arch §4.4 (methods), arch §4.7 (the harness boundary),
   arch §5.4 (approvals), arch §10, arch §11, arch §12.
4. `packages/app-server-protocol/src/protocol.ts` (all) and
   `test/protocol.test.ts`.
5. Desktop main: `apps/desktop/src/main.ts` (all), `src/main/host.ts` (all),
   `src/main/router.ts` (all), `src/main/server.ts` (all),
   `src/shared/host-protocol.ts` (all), `src/shared/keybindings.ts` (all).
6. Desktop renderer: `src/renderer/store.ts:100-200` (state shape, `panel`),
   `:1277-1300` (`refreshDiff`, `setPanel`), `components/thread-view.tsx`
   (all, `SidePanel` at 172-223), `components/changes.tsx` (all),
   `components/git.tsx:713-790` (`HandoffDialog`), `components/activity.tsx` (all),
   `components/composer.tsx:180-345` (attachments), `keys.ts` (all),
   `styles.css` (the `@theme inline` block and the `kc-*` classes).

Phase S2b also:

7. `packages/cli/src/app-server/diff.ts:143-270` (`ScopeTrees`,
   `scopeTrees`), `:448-530` (`readDiff`, `readThreadDiff`);
   `workspaces.ts:921-970` (`handoffChanges`, its refusals before the first
   write, `mkdirSync(saved)` at 970); `threads.ts` `handoff` handler; `file-search.ts` (limits
   style); `git.ts` (`runGit`).
8. `node_modules/@pierre/diffs/dist/types.d.ts:1-60,340-360` (`FileContents`,
   `oldFile`/`newFile`, `hunkSeparators`, `expandUnchanged`) and
   `dist/components/File.d.ts`.
9. `apps/desktop/src/main/open-path.ts` (`refuseToOpen`).

Phase S3 also:

10. `packages/cli/src/extensions/mcp/` `index.ts`, `tools.ts` (all;
    `convertMcpResult` at 265, `createMcpToolDefinition` at 311),
    `resources.ts`, `runtime.ts`; `packages/mcp/src/client.ts` (all).
11. `packages/cli/src/app-server/threads.ts:1575-1665` (`extensionFactories`,
    `threadExtensions`, the `app-server-bridge`), `transcript.ts` and
    `item-mapper.ts` (where Phase C reads `details.view`).
12. `packages/cli/src/core/event-bus.ts`, `core/extensions/loader.ts:570-590`
    (`pi.events`).
13. The MCP Apps specification, Stable 2026-01-26:
    `https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx`
    (all of it; "MCP Apps coverage" under Phase S3 lists what this plan
    implements).
14. Electron 44 docs: `<webview>` tag, `will-attach-webview`,
    `session.fromPartition`, `webContents.capturePage`,
    `protocol.handle`; node-pty's README (Windows ConPTY).

Phase S4 also:

15. `apps/desktop/forge.config.ts`, `package.json`, `scripts/link-electron.ts`;
    `scripts/build.ts` (targets at 100-125, `copyRuntimeAssets`);
    `.github/workflows/publish.yml` (the binary matrix and smoke tests).
16. The IDE-era update route and its logic, deleted by the IDE sunset:
    `git show 954451f04^:apps/web/app/api/ide/releases/[channel]/[version]/asset/route.ts`
    and `git show 954451f04^:apps/web/lib/ide-release.ts`.

Phase D also:

17. architecture.md arch §7 (as amended); `packages/cli/src/main.ts:640-1000`
    (mode dispatch, `InteractiveMode` construction at 993);
    `modes/interactive/interactive-mode.ts` (all 7,125 lines, reading for
    every `this.session.*`, `this.runtimeHost.*` and component that takes a
    session); `app-server/entry.ts` (the bootstrap D0 copies); `app-server/in-process.ts`,
    `client.ts`, `server.ts`, `dialogs.ts`; `core/agent-session.ts` public
    surface; `modes/rpc/rpc-mode.ts:133-240` (how RPC maps extension UI).

---

## 1. Problem

Phase C finished the server phases the desktop needs (A, A2, A3, B, C) and the
desktop phases S1 and S2. What desktop-shell.md section 19 still asks for, and
what the code shows:

- **No file view.** The side panel has one tab, Changes
  (`thread-view.tsx:188`: "other tabs come with the terminal and files
  panes"). A path in a tool row opens nothing; "Open in editor" hands the file
  to the system's default app (`open-path.ts:4`: "ponytail: an extension
  list; detecting editors ... replaces it").
- **Hunks cannot expand.** `DiffFile` carries hunks only
  (`protocol.ts:207-223`); the pane has no file contents to expand into.
- **Handoff refuses late.** "Move to main checkout" fails only after the user
  confirms, with `localChanges` or `operationInProgress`
  (`workspaces.ts:927,942,965`); it should be disabled up front.
- **No terminal, no preview, no third-party UI.** The renderer's CSP already
  names a scheme nothing serves (`main.ts:39`: `frame-src kc-ext:`).
- **Not installable.** `forge.config.ts:11`: "Packaging, signing and the
  bundled knightcode binary are phase S4". A packaged build looks for a binary
  nobody places (`server.ts:21-23`). No update path, no release workflow, no
  end-to-end test (§16 asks for Playwright), no memory figures (§18).
- **The TUI drives the session directly.** `interactive-mode.ts` holds 194
  `this.session.*` / `this.runtime*` references; approvals modes, the
  server-side queue, worktree threads and extension views reach it only
  through the app server (arch §1.2).

## 2. Decisions

| # | Question | Decision | Rejected, and why |
| --- | --- | --- | --- |
| D1 | Where built-in panes run | Native in the app: the diff review stays renderer React, the terminal is `node-pty` loaded with `createRequire` in main, and the preview is a `<webview>` | The old §12 SDK model (every built-in in a sandboxed frame over a `MessagePort`, PTYs in a `utilityProcess`): the user chose native panes; it costs an SDK, a scheme, a process and a rewrite of a working Changes pane for no user-visible gain |
| D2 | Third-party UI | MCP Apps (SEP-1865, Stable 2026-01-26): a tool that names `_meta.ui.resourceUri` gets its `ui://` HTML drawn in a sandboxed iframe on a per-app origin, bridged to the app server. The frame is `sandbox="allow-scripts allow-same-origin"` with no referrer. The spec's sandbox proxy (a second iframe on another origin) is required of web hosts only; a desktop host draws the View directly, and the per-instance `kc-mcp-app://` origin already keeps it apart from the app | A KnightCode-only `desktop.json` package type (a format nobody else ships; MCP Apps is a published extension with servers already using it); `@modelcontextprotocol/ext-apps`' host bridge (a new dependency, with its own dependency tree to review, for about a dozen messages) |
| D3 | Terminal process | `node-pty` in Electron main, one manager, PTYs keyed by thread, 64 KiB scrollback each for reattach | A `utilityProcess` (the isolation guards against a native crash that ConPTY/node-pty rarely has, at the cost of a process and an IPC hop); the app server's `shell/exec` (sized for `!` commands, arch §7.2) |
| D4 | Preview host | `<webview>` in the renderer, partition `persist:kc-preview:<threadId>`, guarded in main by `will-attach-webview` | `WebContentsView` (main must hide it whenever a menu or modal overlaps: the renderer has to report every overlap; a `<webview>` is in the DOM and stacks normally). Agent control later (L3) still works: main reaches the guest through `webContents.fromId` and `webContents.debugger`. Also rejected: one partition per tab (a sign-in in one tab would not carry to the thread's next tab) |
| D5 | File contents for file tabs and hunk expansion | Two server methods: `file/read` and `thread/diff/file` (section 4.1). The server reads files, as §17 requires | Reading files in main (§17 excludes it); shipping contents inside `thread/diff/read` (every read would carry every file twice) |
| D6 | Handoff pre-check | `thread/handoff` gains `dryRun`: every refusal check runs, nothing is written | Reimplementing the checks in the renderer from `git/status` (it cannot see ignored files in the way, `workspaces.ts:963-968`) |
| D7 | Signing | None in v1 (no certificates). Builds are unsigned on Windows, ad-hoc signed on macOS; Forge reads signing and notarization credentials from environment variables and signs only when they are set | Blocking the release on certificates |
| D8 | Updates | Electron `autoUpdater` (Squirrel) on Windows against a knightcode.dev route over GitHub releases tagged `desktop-v<version>`; on macOS, which cannot update an unsigned app, the same feed drives an "Update available" banner that opens the release page; Linux updates by reinstalling the package | update.electronjs.org (it serves the repository's newest release, which is a CLI release here); updating inside the app server (it would replace itself mid-session) |
| D9 | Release trigger | A `workflow_dispatch` "release button" (prerelease) that builds every target from `main` at the version changesets set, then tags it and drafts the release, as the IDE's did (WP05). Amended 2026-10-25: it no longer bumps the version itself (see D10) | A tag push (a tag pushed with `GITHUB_TOKEN` triggers no workflow) |
| D10 | Desktop version | Independent of the CLI's: `apps/desktop/package.json`, tags `desktop-v<version>`. Amended 2026-10-25: versioned by `@knightcode/desktop` changesets. Changesets versions only packages that are not private (`privatePackages.version: false`), so `apps/desktop` is not private, with a `prepublishOnly` that refuses `npm publish` (`ci:publish` only publishes the CLI). The Version Packages PR bumps it and writes `apps/desktop/CHANGELOG.md`; one with only desktop changesets publishes no CLI, since the CLI neither depends on the app nor shares a fixed group with it. The draft's notes are that changelog since the last published desktop release | Locking it to the CLI version (a CLI patch would force a desktop release); filing desktop changes under the CLI's changeset (they landed in the terminal's changelog); a workflow-side bump beside changesets (two writers of one version); versioning private packages again with the libraries in `ignore` (every private package, and every new one, would have to be listed, or it gets "Updated dependencies" bumps) |
| D11 | Phase D shape | The TUI's app server is always in-process (arch §2). Every action that changes a session (prompts, steering, queueing, interrupts, model and settings changes, tree moves, forks, compaction, `!` commands, retries) goes through protocol methods, so the server's queue, turn markers, locks and approvals apply. Reads and live events go through local handles (arch §7.3), which only the in-process transport has: the session's own `AgentSessionEvent` objects, read-only access to its `SessionManager` and stats, and the TUI's own `ExtensionUIContext` bound as the UI of the threads it holds, so synchronous UI methods keep working. A facade, `RemoteSession`, gives `InteractiveMode` the members it uses today, so its renderers and components do not change and resyncs stay mechanical | Rendering the TUI from protocol items (rewrites every renderer; every resync becomes a hand translation; the user asked on 2026-10-23 to keep these files unchanged where possible). Carrying session events and entries over the wire in `toJsonEvent` shape (review round 1: it is lossy, since `toJsonEvent` drops partials that carry data no delta repeats, `anthropic-messages.ts:753-762`; message events lack persisted entry ids, `session-manager.ts:1301-1309`; and full entry reads would need paging under the 64 MiB stdio cap) |
| D12 | Print mode and `--mode json` | Unchanged: they stay on the direct session, identical to upstream, as RPC mode does (user, 2026-10-23) | Moving them in slice 1 as arch §7.1 had it (a format change or a translation layer, for no user gain) |

## 3. Ownership

| Unit | Owns | Does not own |
| --- | --- | --- |
| App server (`packages/cli/src/app-server/`) | File reads, diff contents, the handoff dry run, the MCP App bridge methods and their approval gate, the session-event stream for Phase D | Any pixel; PTYs; the preview |
| MCP extension (`packages/cli/src/extensions/mcp/`) | The MCP Apps client capability, `details.mcpApp` on tool results, app-only tools, answering bridge requests on `pi.events` | Approval decisions (the app server's) |
| Main (`apps/desktop/src/main/`) | PTYs (`terminals.ts`), editor detection and launch (`open-in.ts`), the `kc-mcp-app://` scheme and its HTML store (`mcp-apps.ts`), `<webview>` guards and preview captures (`preview.ts`), updates (`updates.ts`) | Git, file reads, settings (§17) |
| Renderer (`apps/desktop/src/renderer/`) | Side panel tabs (Changes, File, Preview, MCP App), the bottom region with terminals, the MCP Apps host bridge (`mcp-app-bridge.ts`) | Network access other than `app://` and the frames it embeds |
| Release (`apps/desktop/scripts/`, `.github/workflows/desktop-release.yml`, `apps/web/app/api/desktop/`) | Staging the binary, makers, the feed, drafts | Publishing (the owner publishes a draft) |
| TUI (`packages/cli/src/modes/interactive/`) | Rendering, input, local component factories | The session (the app server's after D) |

Harness boundary (arch §4.7): no phase edits `packages/agent`, `packages/ai`
or `packages/cli/src/core` except Phase D's type exports, each named in its
task with the reason it cannot live in `app-server/`.

---

## 4. Interfaces

### 4.1 Protocol additions (`packages/app-server-protocol/src/protocol.ts`)

S2b:

```ts
"file/read": {
	params: Obj({
		threadId: Str,
		/** Relative to the thread's cwd, or absolute. */
		path: Str,
		maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 * 1024 * 1024 })), // default 2 MiB
	}),
	result: Obj({
		path: Str,          // absolute
		size: Num,
		binary: Bool,       // a NUL byte in the first 8 KiB
		tooLarge: Bool,     // size > maxBytes: `text` absent
		text: Type.Optional(Str),
	}),
},
// "thread/diff/read" result gains the two trees `scopeTrees` resolved for it (diff.ts:143-150, `from`/`to`):
fromTree: Type.Optional(Str),
toTree: Type.Optional(Str),

"thread/diff/file": {
	/**
	 * Both sides of one file of a diff already read: the trees come from that read's result, so the contents
	 * always match its hunks, whatever changed on disk since. Trees and blobs are immutable git objects.
	 */
	params: Obj({ threadId: Str, fromTree: Str, toTree: Str, path: Str, oldPath: Type.Optional(Str) }),
	/** Absent side: added or deleted. */
	result: Obj({
		old: Type.Optional(Str),
		new: Type.Optional(Str),
		binary: Bool,
		tooLarge: Bool,     // a side over 2 MiB: both absent
	}),
},
// "thread/handoff" params gain:
dryRun: Type.Optional(Bool), // run every refusal, write nothing; result `{thread, warnings: []}` unchanged
```

S3:

```ts
// WireItem toolCall gains:
/** The tool's MCP App (§12): set from `details.mcpApp` on both the live and read-back paths. */
mcpApp: Type.Optional(
	Obj({
		server: McpServerName,
		resourceUri: Str,
		/**
		 * The server's CallToolResult, `_meta` and `structuredContent` included, for the app's
		 * `ui/notifications/tool-result`. The session's tool result message keeps neither (`ToolResultMessage`,
		 * packages/ai/src/types.ts:636), so the MCP extension stores it in `details`. Absent over 256 KiB serialized
		 * (`resultOmitted`): the app then gets the text content only.
		 */
		result: Type.Optional(Type.Unknown()),
		resultOmitted: Type.Optional(Bool),
	}),
),

"mcp/app/readResource": {
	/** `resources/read` on the thread's connection to `server`: the app's HTML, and the app's own reads. */
	params: Obj({ threadId: Str, server: McpServerName, uri: Str }),
	result: Type.Unknown(),                        // ReadResourceResult, at most 4 MiB serialized
},
"mcp/app/callTool": {
	params: Obj({
		threadId: Str,
		server: McpServerName,
		tool: Str,
		arguments: Type.Record(Str, Type.Unknown()),
		/** The user confirmed this call in the client (Task S3.5's gate). */
		confirmed: Type.Optional(Bool),
	}),
	result: Type.Unknown(),                        // the server's CallToolResult, `_meta` included; at most 4 MiB serialized
},
```

New error codes in `ErrorCode` (`protocol.ts:26-45`): `approvalRequired` (a
`mcp/app/callTool` the gate refuses without `confirmed`) and `mcpUnavailable`
(the thread has no connected MCP server of that name). A tool the app may not
call (another server's, or one whose `_meta.ui.visibility` leaves out
`"app"`) answers `invalidParams`.

D: see Phase D, Task D0 (local handles on the in-process transport, arch
§7.3) and D1-D5 (the arch §7.2 methods). No session events or entries go
over the wire.

### 4.2 Host methods (`apps/desktop/src/shared/host-protocol.ts`)

```ts
// S2b
"host/openIn/list": { params: Obj({}), result: Obj({ targets: Type.Array(Obj({ id: Str, name: Str, kind: TargetKind, icon: Type.Optional(Str) })) }) }, // desktop-shell.md 4.4; kind is editor, terminal, fileManager or systemDefault; icon a data URL
"host/openIn/open": {
	params: Obj({ targetId: Str, path: Str, line: Type.Optional(Num), column: Type.Optional(Num) }),
	result: Obj({}),
},
// The Open menu's "Save as…": an absolute path copied where the user picks; `path` absent when cancelled.
"host/file/saveCopy": { params: Obj({ path: Str }), result: Obj({ path: Type.Optional(Str) }) },
// S3: terminal
"host/terminal/shells": { params: Obj({}), result: Obj({ shells: Type.Array(Obj({ id: Str, name: Str })), default: Str }) },
"host/terminal/create": {
	params: Obj({ threadId: Str, cwd: Str, shell: Type.Optional(Str), cols: Num, rows: Num }),
	result: Obj({ id: Str, name: Str }),
},
"host/terminal/attach": { params: Obj({ id: Str }), result: Obj({ scrollback: Str, exited: Type.Optional(Num) }) },
"host/terminal/list": { params: Obj({ threadId: Str }), result: Obj({ terminals: Type.Array(Obj({ id: Str, name: Str, cwd: Str })) }) },
"host/terminal/write": { params: Obj({ id: Str, data: Str }), result: Obj({}) },
"host/terminal/resize": { params: Obj({ id: Str, cols: Num, rows: Num }), result: Obj({}) },
"host/terminal/kill": { params: Obj({ id: Str }), result: Obj({}) },
// S3: preview
/** The bindings main forwards from a focused preview guest: id to key strings, as keys.ts resolved them. */
"host/keys/set": { params: Obj({ bindings: Type.Record(Str, Type.Array(Str)) }), result: Obj({}) },
"host/preview/capture": {
	params: Obj({ webContentsId: Num, rect: Obj({ x: Num, y: Num, width: Num, height: Num }) }),
	result: Obj({ path: Str }),                  // a PNG in the paste directory
},
// S3: MCP Apps
"host/mcpApp/serve": {
	params: Obj({
		html: Str,
		/** The resource's `_meta.ui.csp`, as declared; each list of origins. */
		csp: Type.Optional(
			Obj({
				connectDomains: Type.Optional(Type.Array(Str)),
				resourceDomains: Type.Optional(Type.Array(Str)),
				frameDomains: Type.Optional(Type.Array(Str)),
				baseUriDomains: Type.Optional(Type.Array(Str)),
			}),
		),
	}),
	result: Obj({ url: Str }),                     // kc-mcp-app://<uuid>/index.html
},
"host/mcpApp/release": { params: Obj({ url: Str }), result: Obj({}) },
// S4
"host/update/check": { params: Obj({}), result: UpdateState },
"host/update/install": { params: Obj({}), result: Obj({}) },
```

Host events gain `{ event: "terminal/data"; id; data }`,
`{ event: "terminal/exit"; id; code }`, `{ event: "key"; binding: string }`
(a binding typed into a focused preview guest), `{ event: "update"; state: UpdateState }`
where `UpdateState = { status: "idle" | "checking" | "available" | "downloading" | "ready" | "error"; version?; url?; message? }`.

### 4.3 Main modules

```ts
// src/main/open-in.ts
export interface OpenInTarget { id: string; name: string; kind: TargetKind; iconPath?: string; command: string; args(path: string, line?: number, column?: number): string[] }
export function detectTargets(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<OpenInTarget[]>;

// src/main/terminals.ts
export class Terminals {
	constructor(options: { env: NodeJS.ProcessEnv; send(windowIds: number[], event: HostEvent): void });
	shells(): { shells: { id: string; name: string }[]; default: string };
	create(windowId: number, params: { threadId: string; cwd: string; shell?: string; cols: number; rows: number }): { id: string; name: string };
	attach(windowId: number, id: string): { scrollback: string; exited?: number };
	detachWindow(windowId: number): void;
	write(id: string, data: string): void;
	resize(id: string, cols: number, rows: number): void;
	kill(id: string): void;
	killThread(threadId: string): void;   // thread/archived (archived: true), thread/deleted
	killAll(): void;                      // quit
}

// src/main/mcp-apps.ts
export function registerMcpAppScheme(): void;              // before app ready, privileged standard + secure
export class McpAppStore { serve(windowId: number, html: string, csp?: AppCsp): string; release(url: string): void; releaseWindow(windowId: number): void; handle(request: Request): Response }

// src/main/preview.ts
export function guardWebviews(contents: WebContents): void; // will-attach-webview + partition setup
export function capture(sender: WebContents, webContentsId: number, rect: Rectangle): Promise<string>;

// src/main/updates.ts
export class Updates { constructor(options: { feedBase: string; version: string; platform: string; arch: string; send(state: UpdateState): void }); check(): Promise<UpdateState>; install(): void }
```

### 4.4 MCP extension (`packages/cli/src/extensions/mcp/`)

```ts
// details on an MCP tool result (tools.ts McpToolDetails, today {server, tool, fullOutputPath?}) gain:
mcpApp?: { server: string; resourceUri: string; result?: CallToolResult; resultOmitted?: true };

/** Event bus channel the app server's bridge emits on; the MCP extension answers through `reply`. */
export const MCP_APPS_CHANNEL = "knightcode.mcp-apps";
type Failure = { ok: false; code: "mcpUnavailable" | "invalidParams" | "internal"; message: string };
export type McpAppsRequest =
	| { op: "readResource"; server: string; uri: string; reply(r: { ok: true; result: ReadResourceResult } | Failure): void }
	/** Refuses a tool whose `_meta.ui.visibility` leaves out "app" (the spec's MUST). */
	| { op: "call"; server: string; tool: string; arguments: Record<string, unknown>; reply(r: { ok: true; result: CallToolResult } | Failure): void }
	/** What the gate needs before calling: the tool's `annotations.readOnlyHint` and its visibility. */
	| { op: "describe"; server: string; tool: string; reply(r: { ok: true; readOnly: boolean; app: boolean } | Failure): void };
```

---

## 5. Tasks

A ledger per phase in `.superpowers/sdd/<phase>-plan/progress.md` records
each task's evidence and every ruling that departs from this plan, as Phases A
to C did.

### Phase S2b — files, Open in, hunk expansion, handoff pre-check

Branch `feat/desktop-files-open-in`, one PR.

#### Task S2b.0: protocol

- Add `file/read`, `thread/diff/file` and `thread/handoff`'s `dryRun`
  (section 4.1) with schema tests in `test/protocol.test.ts`: limits at
  their bounds, a negative `maxBytes`, an unknown field.
- Regenerate `packages/cli/docs/app-server.schema.json`.

#### Task S2b.1: the server

- `packages/cli/src/app-server/files.ts` (new): `readFile(thread, path,
  maxBytes)`. Resolves a relative path against the thread's cwd; refuses a
  directory (`invalidParams`); reads at most `maxBytes + 1` bytes; detects
  binary by a NUL in the first 8 KiB; text is UTF-8 with replacement. Not
  confined to the workspace: a tool row may name any file the agent read.
- `diff.ts`: `readThreadDiff` returns the `from` and `to` trees it diffed
  as `fromTree`/`toTree` (absent when a scope has none, such as a stale
  `lastTurn`). `readDiffFile(repo, fromTree, toTree, path, oldPath?)` checks
  both trees exist in the thread's repository (`git cat-file -e`;
  `invalidParams` otherwise) and reads each side with `git cat-file blob
  <tree>:<path>` (`oldPath` on the old side for a rename). A missing side is
  absent; a side over 2 MiB answers `tooLarge` with no text; a binary side
  answers `binary`. Working-tree and index snapshots are written as tree
  objects by the read (`workingTree`, 165-176), so a later edit on disk never
  mixes into the contents of an earlier read.
- Handoff dry run. The refusals live in two places today: `threads.ts`'
  `handoff` handler (595-660: "send a message first", direction, environment,
  `repoHead`, `assertCheckoutsFree`, `operationIn` before a local thread's
  first worktree is created at 638) and `workspaces.ts` `handoffChanges`
  (921-1046: operation in progress, local changes in the destination,
  submodules, ignored files in the way, then the branch: name validity and
  `branchExists` at 1042-1046, after the first write at 970). Extract
  `planHandoff(input)` in `workspaces.ts`: every check of `handoffChanges`
  that only reads (including the branch choice at 1036-1046), returning
  what the move needs, and have `handoffChanges` call it first. With
  `dryRun`, the handler runs its own checks, then `planHandoff`, and writes
  nothing: for a local thread with no worktree yet it does not create one
  and runs no setup script, so `planHandoff` checks only what does not
  depend on the destination. The real handoff keeps every check after
  preparing the worktree (`threads.ts:638-650` prepares it,
  `workspaces.ts:805-826` runs a trusted environment's setup script, and
  `workspaces.ts:934-946` then refuses local changes in it), so a setup
  script that leaves files behind still fails the real call with
  `localChanges` after a dry run passed. The thread is not reserved past
  the call.
- Handlers in `threads.ts` `handlers()`; `file/read` and `thread/diff/file`
  take the thread through `withThread` (loaded, any mode).

#### Task S2b.2: Open in

- `src/main/open-in.ts`: `detectTargets` per §9.9's order. Windows: PATH
  (`code`, `cursor`, `windsurf`, `zed`, `subl`, `idea64`, `webstorm64`,
  `notepad++`), then `%LOCALAPPDATA%\Programs\<app>\<exe>`, then `Program
  Files`, then Start Menu shortcuts' targets; macOS `/Applications/*.app`
  for the same list plus Xcode; Linux PATH and `.desktop` files. Each entry
  knows its goto syntax (`--goto path:line:column` for VS Code family and
  Cursor/Windsurf, `path:line:column` for Zed and Sublime, `--line` for
  JetBrains). Plus three fixed entries: the file manager
  (`shell.showItemInFolder`), a terminal at the folder, and "Default app"
  (today's `openPath`, still behind `refuseToOpen`). Results cached 60 s.
- Launch with `spawn(command, args, { detached: true, stdio: "ignore",
  windowsHide: true }).unref()`. A Windows `.cmd` shim is never run through
  a shell: resolve it to the editor's own exe (the `bin\code.cmd` shim sits
  in `<install>\bin`, the exe one level up); a shim with no exe found is left
  out of the list.
- `host/openIn/list` and `host/openIn/open` in `host.ts`; the `targetId` must
  be one `detectTargets` returned (`invalidParams` otherwise).
- Preferences gain `openIn?: string` (the last choice). There is no Open
  button in the thread header: a file tab's toolbar carries its "Open"
  split button (the last editor, a chevron listing the rest), and it and the
  Changes pane's file menu open the file at its line.

#### Task S2b.3: side panel tabs and file tabs

- `store.ts`: `panel.tabs: PanelTab[]` and `panel.active: number` per window,
  `PanelTab = { kind: "changes" } | { kind: "file"; path: string; line?: number }`;
  actions `openFileTab(threadId, path, line?)` (reuses a tab with the same
  path), `closeTab(i)`, `activateTab(i)`. Changes is always tab 0 and cannot
  close (closing it closes the panel, as now). At most 12 file tabs: opening
  a 13th closes the least recently active file tab.
- `thread-view.tsx` `SidePanel`: the strip renders every tab (a 238px
  pill per tab, icon + name + close), scrolls horizontally past the panel's
  width.
- `components/file-tab.tsx` (new): `file/read`, then `@pierre/diffs`'
  `File` component with the shared highlighter (`preloadHighlighter` first,
  the trap recorded for S2), line numbers, the `line` scrolled into view and
  marked. Binary and too-large files show a one-line notice and "Open in…".
- Entry points: a path in a tool row (`activity.tsx`: read, edit, write,
  find and grep results), the Changes pane's file header menu ("Open file").
- Keybinding `desktop.panel.closeTab` (`mod+shift+w`) closes the active file
  tab.

#### Task S2b.4: hunk expansion

- `changes.tsx` renders each file with `PatchDiff` (`changes.tsx:466`), from
  the read's patch text. Hydration goes through the library's own seam: the
  `options.loadDiffFiles` loader (`node_modules/@pierre/diffs/dist/types.d.ts:353-360`,
  `FileDiffContentsLoader` at 47) calls `thread/diff/file` with the read's
  `fromTree`/`toTree` and returns `{oldFile, newFile}`; with `hunkSeparators`
  set, the library draws the expand chevrons between hunks and upgrades the
  file's metadata in place. The hydrated metadata object is kept per read so
  the expansion survives re-renders (`types.d.ts:216-218`).
- Fallback is ours, not the library's: a failing loader is only logged
  (`dist/components/FileDiff.js:555-563`), and a partial diff stays
  expandable for as long as `loadDiffFiles` is set
  (`dist/renderers/DiffHunksRenderer.js:664-665`), so the chevrons stay and
  the next click loads again. A file is given the loader only while its read
  has tree ids and the file is not marked unavailable; when
  `thread/diff/file` answers `tooLarge` or `binary`, or fails, the file is
  marked unavailable for that read and re-rendered without `loadDiffFiles`,
  with today's `hunkSeparators: "line-info"` (`changes.tsx:358`), which then
  draws no expand control.
- Identity per read: `PatchDiff` memoizes parsed metadata by patch text
  alone (`usePatch`, `dist/react/PatchDiff.js:47-48`), and a new read can carry the same
  patch with other trees. The file's `PatchDiff` is keyed by the read (its
  trees and path), so a new read (after `turn/diff/updated`, a revert, a
  commit or the existing refresh paths, `store.ts:1277`) gets fresh
  metadata and never reuses stale contents.
- Unchanged: hunk actions target hunk ids (`protocol.ts:190-196`); comments
  anchor on scope, path, side and line range (`protocol.ts:225-251`), which
  expansion does not move.
- Tests (renderer): expansion after a successful load; after a failed one
  the expand controls are gone and no click issues another load; a new
  read with identical patch text and
  different trees loads again; a comment and a hunk action on an expanded
  file still reach the right lines.

#### Task S2b.5: handoff pre-check

- `git.tsx` `HandoffDialog`: the dialog sends `thread/handoff` with
  `dryRun: true` when it opens and again whenever the params it would send
  change (the branch name is editable, `git.tsx:756-760`, and sent at
  727-731), debounced 250 ms. While a check runs, "Hand off" is disabled; a
  result for params that are no longer current is ignored. A refusal shows
  the server's message (with the paths of a `localChanges` refusal) in the
  dialog; success enables the button. The confirm still sends the real
  handoff, whose own refusal is shown as today (the checkout can change in
  between, and a new worktree's setup can leave files, Task S2b.1).
- Test: editing the branch to an existing one disables the button after its
  check; editing it back enables it; a slow check for an old name never
  overrides a newer one.

#### Task S2b.6: docs, changeset

- `docs/app-server.md`: the three additions under their sections; arch §4.4
  and §6 rows; §9.9 status line; `docs/desktop.md`: file tabs, Open in.
- Changeset (`bun run changeset Added`): "Added `file/read` and
  `thread/diff/file` to the app server, and a dry run for `thread/handoff`."

### Phase S3 — terminal, preview, MCP Apps

Branch `feat/desktop-terminal-preview-apps`, one PR.

#### Task S3.0: dependency probe and approval (before any code)

- Candidates, each pinned exactly at the newest release older than the
  `.npmrc` `min-release-age`: `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`.
  Record for `node-pty`: its install scripts, whether it ships prebuilt
  binaries for win32-x64, darwin-arm64, darwin-x64 and linux-x64, and whether
  `bun install` builds it without a compiler on this machine.
- In a scratch copy of `apps/desktop` (never the user's app data), prove:
  `node-pty` loads in Electron 44's main after `@electron/rebuild`; Forge's
  Vite plugin packages it (the Vite build leaves `node_modules` out, so it
  needs `rollupOptions.external: ["node-pty"]` in `vite.main.config.ts`, a
  `packageAfterCopy` hook copying it from the hoisted root `node_modules`,
  and `asar.unpack` for its `.node` files); a `<webview>` guest is unaffected
  by the renderer's CSP; `will-attach-webview` sees the partition.
- Stop and ask the user to approve the three dependencies (AGENTS.md:
  lifecycle scripts need review; the lockfile commit needs
  `KNIGHTCODE_ALLOW_LOCKFILE_CHANGE=1` with their OK).

#### Task S3.1: the bottom region

- `thread-view.tsx`: a bottom region under the thread and side panel,
  resizable from its top edge, at least 160px, shuts when dragged
  under 80px, at most what leaves the transcript 160px. `store.ts`:
  `bottom: { open: boolean; height: number }` per window, kept in memory like
  `panel`.
- Keybindings: `desktop.terminal.toggle` (`mod+j`), `desktop.terminal.new`
  (`` mod+backquote ``), `desktop.terminal.next`/`previous`
  (`ctrl+pagedown`/`ctrl+pageup`), all in the palette.

#### Task S3.2: terminals in main

- `src/main/terminals.ts` (section 4.3). `node-pty` via
  `createRequire(__filename)("node-pty")`. Env: the login
  shell env main already computes (`loginShellEnv()`), `TERM=xterm-256color`,
  `COLORTERM=truecolor`, `KNIGHTCODE_DESKTOP=1`. Shells per §9.7 (Git Bash
  and WSL listed on Windows when found).
- Each PTY keeps a 64 KiB ring of its output; `attach` returns it, then
  `terminal/data` events go to every window attached. Data is batched per
  PTY per 16 ms before posting.
- `router.ts`: an `onServerNotification` hook main uses to call
  `killThread` on `thread/archived` with `archived: true` and on
  `thread/deleted`. `before-quit` calls `killAll` after the server stops.
  Window close detaches the window's terminals; they keep running for the
  thread.
- The cwd must be an existing absolute directory (`invalidParams`
  otherwise); a terminal whose cwd is outside the thread's workspace says so
  in its tab (§9.7).

#### Task S3.3: the terminal in the renderer

- `components/terminal.tsx` (new): xterm.js with the fit addon, font from
  `--kc-font-code`/`--kc-size-code`, colours from new tokens
  `--kc-ansi-0`...`--kc-ansi-15`, `--kc-terminal-bg`, `--kc-terminal-fg` in
  `styles.css`. The CLI's `theme/dark.json` and `light.json` hold semantic
  colours, not 16 ANSI slots, so the slots are fixed values: xterm.js's own
  default palette in dark, and VS Code's default light-theme terminal
  palette in light (its white slots are greys, readable on a light
  surface); `--kc-terminal-bg` is the
  surface and `--kc-terminal-fg` the text token. The theme updates on a
  token change.
- Tab strip per thread: shell name + cwd basename, + (with the shell menu),
  close, the chevron that shuts the region. "Terminal ended (code N) —
  Restart" on exit.
- Keys: `attachCustomKeyEventHandler` passes a key to the app only when
  `matches(event, id)` (keys.ts) finds an app binding that is allowed over a
  terminal (`desktop.terminal.*`, palette, sidebar, panel toggles, new
  thread); everything else goes to the PTY. Copy: `desktop.terminal.copy`
  (`ctrl+shift+c`; `mod+c` on macOS), paste `desktop.terminal.paste`
  (`ctrl+shift+v`; `mod+v`). No `event.key ===` outside the dispatcher (§18).
- Reattach on reload: `host/terminal/list` then `attach`, writing the
  scrollback first.

#### Task S3.4: the preview

- `main.ts`: `webviewTag: true` in `webPreferences`; `guardWebviews` on every
  window's webContents: in `will-attach-webview` delete the preload, force
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  refuse (`preventDefault`) a partition not matching
  `^persist:kc-preview:[0-9a-zA-Z-]{1,64}$` or a `src` that is not http,
  https or `about:blank`. Each partition's session, once: permission
  requests denied, `will-download` asks with a native save dialog, the
  guest's `setWindowOpenHandler` opens http(s) in the same webview and denies
  the rest, `will-navigate` and `will-redirect` limited to http and https
  (`isPreviewUrl` in `shared/`, also used by the address bar). Neither event
  fires for `loadURL`, `back` or `forward` (`electron.d.ts:17841-17842`), so
  the renderer is the only programmatic loader and checks first.
- `components/preview.tsx` (new), a side panel tab
  `{ kind: "preview"; url: string }`: an address bar
  (`desktop.preview.address`, `mod+l`), back, forward, reload, open in
  browser, all through the `<webview>` element's own methods. Partition per
  thread (D4). A bare `localhost:3000` gets `http://`; input that is still
  not `isPreviewUrl` is refused in the bar and never reaches `loadURL`.
- Annotate: drag a rectangle over the page, `host/preview/capture` with the
  guest's `getWebContentsId()`. Main checks the guest's `hostWebContents` is
  the sender before `capturePage(rect)`, writes the PNG beside pasted images
  (`host.ts:146`), and the renderer attaches the path to the thread's composer
  with the page URL appended to the draft. `store.ts` gains
  `composerAttach(threadId, path)`, which the composer's image list consumes
  (it is local state today, `composer.tsx:185`).
- Keys: while a guest has focus its key events never reach the renderer's
  dispatcher. Main listens to `before-input-event` on each guest and, for a
  key matching an app binding allowed over the preview (`desktop.preview.*`,
  palette, sidebar, panel and terminal toggles, new thread), prevents it and
  sends a `{ event: "key", binding }` host event that the dispatcher runs as
  if typed in the window. The window's bindings, with the user's overrides, are
  sent to main whenever they change (`host/keys/set`), so main never
  hardcodes a key.
- Entry points: "Open preview" in the side panel's + menu; a `localhost` URL
  in a tool output or message offers "Open in preview".
- `thread/deleted`: main clears that thread's partition storage.

#### Task S3.5: MCP Apps, server side

- `packages/mcp/src/protocol/types.ts:23`: `ClientCapabilities` gains
  `extensions?: Record<string, unknown>` (the field the spec's capability
  lives in; the type has none today).
- `extensions/mcp/`: only when the extension runs in the `"desktop"` mode
  (`ctx.mode`, the mode the app server gives stdio clients' threads, arch
  §2), the client's `initialize` carries `extensions:
  { "io.modelcontextprotocol/ui": { mimeTypes:
  ["text/html;profile=mcp-app"] } }`. The terminal cannot draw an app, so it
  does not advertise one and servers send their text fallback.
- `extensions/mcp/tools.ts`: a tool whose `_meta.ui.resourceUri` (or the
  deprecated `_meta["ui/resourceUri"]`) is a `ui://` URI puts
  `mcpApp: { server, resourceUri, result }` in its result's `details`
  (`convertMcpResult`, 265-288), `result` being the server's whole
  `CallToolResult` with `_meta` and `structuredContent`, or `resultOmitted`
  over 256 KiB serialized. A tool whose `_meta.ui.visibility` (default
  `["model", "app"]`) leaves out `"model"` is not given to the model (the
  spec's MUST); it stays callable by its app.
- Exposure of a UI tool. A nested call (from a codemode script) is not
  persisted (`core/nested-tool-calls.ts:237`; `transcript.ts:228-239`
  reads details of model-issued calls only), so an app drawn from one would
  vanish on read-back. In order: a tool the user's config hides (`hidden`,
  server-wide or through `toolExposure`, `core/mcp-servers.ts:66-73`)
  stays hidden and draws no app; a tool whose `_meta.ui.visibility` leaves
  out `"model"` is not declared; any other UI tool gets the existing
  `model-only` exposure (`core/extensions/types.ts:534-536`: declared to
  the model, never callable from other tools), whatever the server's
  exposure (default `codemode`, `index.ts:135-136`) and whatever
  `codemode.mode`. So its calls are always model-issued and persisted.
- Startup: the first prompt today waits (bounded) only for servers with
  `direct` tools (`hasDirectTools`, `index.ts:143-146`, used at 1154-1162),
  so a codemode server's UI tools could arrive after the first request. In
  the `"desktop"` mode the same bounded wait covers every enabled server;
  the bound is unchanged.
- `extensions/mcp/index.ts`: subscribes `pi.events.on(MCP_APPS_CHANNEL)`
  (section 4.4). `readResource`: `resources/read` on that server, at most 4
  MiB serialized. `call`: only a tool of that server whose visibility
  includes `"app"`, through the same call path as the model's, the result
  returned whole (the app server bounds it, below). `describe`: the tool's
  `annotations.readOnlyHint` and
  visibility. A server not connected answers `mcpUnavailable`.
- App server: `app-server/mcp-apps.ts` (new) adds an inline extension to
  `threadExtensions` (`threads.ts:1634`) that keeps the thread's
  `pi.events` and turns `mcp/app/readResource` and `mcp/app/callTool` into
  bus requests, with a 60 s timeout (`internal` after it). Both are bounded
  well under the 64 MiB stdio output cap (`stdio.ts:19`, which aborts the
  connection, 54-62) and the input line limit (`stdio.ts:81-82`, which
  drops a line with no answer): `arguments` at most 1 MiB serialized
  (`invalidParams`), and a `readResource` or `callTool` result over 4 MiB
  serialized answers `invalidParams` ("result too large") instead of being
  sent; the app gets that as a JSON-RPC error. The gate, after
  `describe`: `fullAccess` runs any call; `autoEdit` and `ask` run a
  `readOnlyHint` tool and answer `approvalRequired` for any other unless
  `confirmed`. A call during a turn runs; it does not wait for the turn.
- `transcript.ts` and `item-mapper.ts`: `details.mcpApp` to the item's
  `mcpApp`, through the one function Phase C added for `view`, on both
  paths.

#### Task S3.6: MCP Apps, desktop side

- `src/main/mcp-apps.ts`: the scheme `kc-mcp-app`, registered privileged
  (`standard`, `secure`) before ready. `serve` stores the HTML under a new
  UUID host and returns `kc-mcp-app://<uuid>/index.html`; `handle` answers
  only that path. Its CSP starts from the spec's default for an app that
  declares nothing (`default-src 'none'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'
  data:; connect-src 'none'`), adds `resourceDomains` to the script, style,
  img, font and media sources, `connectDomains` to `connect-src`,
  `frameDomains` as `frame-src` (else `'none'`) and `baseUriDomains` as
  `base-uri` (else `'self'`), and appends `frame-ancestors <ORIGIN>`, main's
  trusted renderer origin (`main.ts:34-35`: the Vite dev server's origin in
  development, `app://desktop` packaged). Nothing undeclared is allowed (the
  spec's MUST).
- Every declared entry is validated before it reaches the header: at most
  32 entries per list, each at most 256 characters, matching a host source
  of `https:`, `http:` (localhost and 127.0.0.1 only), `wss:` or `ws:`
  (same rule) with an optional `*.` subdomain wildcard and port, lowercased
  and serialized from its parsed parts. Whitespace, `;`, `,`, quotes,
  keywords (`'self'`, `'unsafe-inline'`, ...), paths beyond `/` and any
  other scheme make `host/mcpApp/serve` answer `invalidParams`, and the tool
  row shows "This app declared an invalid content policy" with its raw
  output. Each app instance has its
  own origin, so `allow-same-origin` gives it no reach into `app://desktop`
  or another app; the resource's `_meta.ui.domain` is ignored, as the spec
  leaves the origin to the host. Entries go when released or when their
  window closes.
- `main.ts` renderer CSP: `frame-src kc-mcp-app:` replaces `frame-src
  kc-ext:`.
- `renderer/mcp-app-bridge.ts` (new): the host side of the spec's JSON-RPC
  2.0 over `postMessage`, accepting only messages whose `source` is the
  frame's `contentWindow` and whose origin is the served URL's. "MCP Apps
  coverage" below lists what it answers and sends. Every request it
  forwards (`tools/call`, `resources/read`, `ui/message`) is refused with
  `-32602` when its params pass 1 MiB serialized, before anything is sent:
  main writes stdin unchecked (`server.ts:150-153`), a line past 64 MiB is
  dropped with no answer (`stdio.ts:81-82`), and the renderer's waiter has
  no timeout (`client.ts:95-103`). The server's own bounds stay.
- `components/mcp-app.tsx` (new): `mcp/app/readResource` of the item's
  `resourceUri`; the first content whose `mimeType` is
  `text/html;profile=mcp-app` (`text`, or base64 `blob`), its `_meta.ui`
  `csp` and `prefersBorder`; `host/mcpApp/serve`; an iframe with
  `sandbox="allow-scripts allow-same-origin"`,
  `referrerpolicy="no-referrer"` and an empty `allow` (no camera,
  microphone, geolocation or clipboard in v1). The iframe is created in an
  effect, not rendered by React, because React removes the DOM without
  awaiting a cleanup: the `useLayoutEffect` cleanup (which runs before React
  removes the DOM) moves it with `moveBefore` (state kept; Electron 44 is
  Chromium 152, TypeScript 5.9's `lib.dom` lacks it, so one ambient
  declaration) into a hidden
  holder on `document.body`, sends `ui/resource-teardown`, and removes it and
  calls `host/mcpApp/release` on the answer or after 1 s. A closing window
  sends nothing; main releases that window's apps when its webContents is
  destroyed.
  `activity.tsx`: a tool row with `mcpApp` draws the app in place of its raw
  output, with the output one click away; `prefersBorder: false` drops the
  card's border and background.

#### MCP Apps coverage (spec 2026-01-26)

The host is a desktop host (the View is drawn directly, D2). It sends nothing
to the View before `ui/notifications/initialized` (the spec's MUST).

| Message | Direction | Kind | What the bridge does |
| --- | --- | --- | --- |
| `ui/initialize` | app to host | request | Answers `protocolVersion: "2026-01-26"`, `hostInfo {name: "knightcode-desktop", version}`, `hostCapabilities {openLinks: {}, serverTools: {}, serverResources: {}, logging: {}, sandbox: {permissions: {}, csp: <as served>}}`, and `hostContext` (below) |
| `ui/notifications/initialized` | app to host | notification | Starts sending; then `tool-input`, then `tool-result` if the call has finished |
| `ui/notifications/tool-input` | host to app | notification | The item's `input`, once (MUST) |
| `ui/notifications/tool-result` | host to app | notification | The item's `mcpApp.result`; when omitted, `{content}` from the item's text output (MUST once the call completes) |
| `ui/notifications/tool-cancelled` | host to app | notification | `{reason}` when the item ends interrupted or declined (MUST) |
| `ui/notifications/host-context-changed` | host to app | notification | Theme, display mode or container size changed |
| `ui/resource-teardown` | host to app | request | Before the frame goes (MUST); waits at most 1 s |
| `tools/call` | app to host | request | `mcp/app/callTool`; `approvalRequired` opens a confirm card naming the server and tool, then retries with `confirmed`; the app's own server only |
| `resources/read` | app to host | request | `mcp/app/readResource` on the app's own server |
| `ui/open-link` | app to host | request | http and https through `host/shell/openExternal`; any other scheme answers `-32000` |
| `ui/message` | app to host | request | A confirm card with the text; then `send` (or queue while a turn runs) as the user's message |
| `ui/request-display-mode` | app to host | request | `inline` and `fullscreen` (a side panel tab `{ kind: "mcpApp"; itemId }`), only modes the app listed in `appCapabilities.availableDisplayModes`; `pip` and anything else answer the current mode |
| `ui/notifications/size-changed` | app to host | notification | The inline frame's height, 48-720px |
| `notifications/message` | app to host | notification | Logged to the renderer console |
| `ping` | either | request | Answered `{}` |
| `ui/update-model-context` | app to host | request | Not in v1: `-32601` (section 8) |
| anything else | app to host | request | `-32601` |

`hostContext`: `theme`; `styles.variables`, the spec's standard keys
(`--color-background-*`, `--color-text-*`, `--color-border-*`,
`--font-sans`, `--font-mono`, `--border-radius-*`, ...) mapped from the
`--kc-*` tokens by one table in `mcp-app-bridge.ts`; `displayMode`;
`availableDisplayModes: ["inline", "fullscreen"]`; `containerDimensions`
(`{maxHeight: 720}` inline, fixed width and height full screen); `locale`;
`timeZone`; `platform: "desktop"`; `toolInfo {id: <item id>, tool: {name}}`.

#### Task S3.7: docs, tests, changeset

- `docs/mcp.md`: "MCP Apps" (what KnightCode supports of the extension, the
  approval gate, app-only tools, the desktop being the only client that draws
  them). `docs/desktop.md`: terminal, preview, MCP Apps. `docs/app-server.md`:
  `mcp/app/*`, `approvalRequired`, `toolCall.mcpApp`. arch §4.4 rows.
- `examples/mcp-app/` (new): a stdio MCP server with one UI tool, used by the
  tests and the docs.
- Changeset (`Added`): "Added MCP Apps: tools that declare an app show it in
  the desktop app."

### Phase S4 — packaging, updates, release readiness

Branch `feat/desktop-release`, one PR. Building the binary needs the user's go
ahead (AGENTS.md: never run `build:binary` unasked); CI runs it.

#### Task S4.0: the bundled binary

- `apps/desktop/scripts/stage-server.ts` (new): runs `bun run
  scripts/build.ts --target=<os-arch>` for the target being packaged (from
  `--platform`/`--arch` arguments, default the host), copies
  `dist/release/<target>/` to `apps/desktop/resources/knightcode/`, and
  writes `resources/knightcode/knightcode.version` (the CLI's
  `package.json` version). `resources/` is gitignored.
- `forge.config.ts`: `extraResource: ["resources/knightcode"]`; a
  `prePackage` hook that fails when the staged directory is missing or its
  version file disagrees with `packages/cli/package.json`.
- `server.ts` `resolveServerCommand`: unchanged path; `host/app/info` reads
  `knightcode.version` when the server is not up.

#### Task S4.1: makers, native modules, icons, signing hooks

- `package.json` gains `"author": "KnightCode"`: Squirrel's required
  `authors` falls back to it and is otherwise empty
  (`electron-winstaller/lib/index.js:208-215`).
- Makers: Squirrel (per-user, `setupIcon`, `name: "KnightCode"`), ZIP and DMG
  for darwin arm64 and x64, deb and rpm for linux x64. Icons from
  `apps/web/public/knightcode-icon.png` and `knightcode-mark.svg`: `.ico`,
  `.icns` and a 512px `.png` generated by a script into
  `apps/desktop/assets/` (committed).
- `node-pty` packaging as proven in S3.0 (`external`, `packageAfterCopy`,
  `asar.unpack`, `@electron/rebuild` per target).
- Signing hooks: `packagerConfig.osxSign` = `{ identity: "-",
  identityValidation: false, continueOnError: false }` (ad hoc) unless
  `APPLE_SIGNING_IDENTITY` is set (then `{ identity, continueOnError: false }`).
  Without `identityValidation: false`, osx-sign looks `"-"` up as a keychain
  identity and throws (`@electron/osx-sign/dist/sign.js:350-356,389`), and
  packager's default `continueOnError` turns any signing failure into a
  warning (`@electron/packager/dist/mac.js:562-563,627-629`). The macOS
  release legs run `codesign --verify --deep --strict` on the packaged app.
  `osxNotarize` only when
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are; Squirrel's
  `windowsSign` only when `WINDOWS_SIGN_*` (or Azure Trusted Signing's
  variables) are. None are set in v1.
- `KNIGHTCODE_DESKTOP_SMOKE=1`: main quits with code 0 once the server
  answers `initialize`, 1 on failure or after 60 s (the CI smoke test).

#### Task S4.2: the update feed

- `apps/web/app/api/desktop/update/[platform]/[version]/route.ts` and
  `apps/web/lib/desktop-release.ts`, restored in shape from the IDE's
  (`954451f04^`): published (not draft, not prerelease) GitHub releases of
  `KnightCodeAI/knightcode` tagged `desktop-v*`, newest by semver.
  `win32-x64/RELEASES` answers the release's `RELEASES` file with its
  `.nupkg` lines rewritten to the asset URLs; `darwin-<arch>` answers
  `{ version, url, notes, pub_date }` for a newer version, 204 otherwise.
  The Vercel project's `GITHUB_TOKEN` (expires 2027-09-12) reads the
  releases.
- `src/main/updates.ts`: packaged builds only. Windows: `autoUpdater` with
  the feed, checked at launch and every 4 hours, `update-downloaded` puts
  "Restart to update" in Settings › About and a title bar badge. macOS: the
  same feed read with `net.fetch`; a newer version shows "Update available —
  Download", opening the release page. Linux: none (About says how to
  update).
- Settings › About: "Check for updates", the state, the button. Squirrel's
  first-run and install events (`--squirrel-*`) are handled before the
  single-instance lock (shortcuts created and removed, then quit).

#### Task S4.3: the release workflow

- `.github/workflows/desktop-release.yml`: `workflow_dispatch` with
  `prerelease: boolean` (amended 2026-10-25, D10: it took a `bump` and
  committed the version to `main`; changesets sets the version now). A
  version job reads `apps/desktop/package.json` on `main`, refuses a version
  already tagged `desktop-v<version>` or with no `## <version>` section in
  `apps/desktop/CHANGELOG.md`, takes the notes from that changelog since the
  newest published desktop release (`scripts/desktop-release-notes.ts`), and
  outputs the commit SHA it read. Every later job checks out that SHA and
  asserts the packaged app's version equals the tag. A build matrix in the
  same run:
  `windows-2022` (win32-x64), `macos-15` (darwin-arm64, and darwin-x64
  cross-built with `--arch=x64` and the bun `darwin-x64` target),
  `ubuntu-22.04` (linux-x64). Each: `bun install --frozen-lockfile`,
  `bun run hydrate:model-data`, `stage-server.ts`, `electron-forge make`,
  the smoke test (`KNIGHTCODE_DESKTOP_SMOKE=1` under `xvfb-run` on Linux;
  darwin-x64 skips it, no free Intel runner), upload. The darwin-arm64 leg
  also runs the real PTY test, macOS's only CI run of it. A last job creates a
  draft release with every artifact, `SHA256SUMS` and those notes; the owner
  publishes it.
- `ci.yml` (which has no desktop job today): a job running `apps/desktop`'s
  check-types and Vitest on Windows and Linux.

#### Task S4.4: end-to-end tests

- Dependency: `@playwright/test`, exact pin; ask the user first (new dev
  dependency).
- Files are `*.e2e.ts`, outside Vitest's default include
  (`**/*.{test,spec}.?(c|m)[jt]s?(x)`; the desktop has no Vitest config and
  `"test": "vitest --run"`), and `apps/desktop/playwright.config.ts` sets
  `testDir: "test/e2e"`, `testMatch: "**/*.e2e.ts"` so Playwright skips the
  Vitest suites.
- `apps/desktop/test/e2e/` with `_electron.launch` on the Vite build, a
  scratch `--user-data-dir` and `KNIGHTCODE_CODING_AGENT_DIR`, and
  `KNIGHTCODE_DESKTOP_SERVER` pointing at `faux-server.ts`, a launcher that
  starts `app-server -e faux-extension.ts`, which registers the faux
  provider (`packages/ai/src/providers/faux.ts`) with scripted replies.
- The §16 flow: launch, open a fixture project, send a prompt, see the
  reply, approve a `bash` call in Ask mode and see "Ran …", interrupt a
  second turn, archive, find it in the archive. Plus: the quit question with
  a running turn (the one §16 item without a test), a terminal echo, a
  preview of a local fixture server, the `examples/mcp-app` server's app
  drawing and calling its tool.
- CI: Windows and Linux (`xvfb-run`).

#### Task S4.5: hardening carried over

- The desktop store guard for two overlapping resumes of the same thread
  (cut from Phase C, round 8): a resume's result is applied only when it is
  the latest resume issued for that thread; an older result is dropped and
  nothing is unsubscribed. Main's holds are per window, not per request
  (`router.ts:232-236`, a `Set<number>`), so both resumes share the window's
  one hold and releasing for the stale one would drop the current one's
  notifications and approvals. Test both response orders with gates and
  event order, no sleeps, and check that later notifications and an approval
  still reach the window.
- `server.ts`: the app server log rotates at 5 MiB, keeping 5 files (the
  ponytail at `server.ts:76`).
- Memory (§18): ten threads across three windows, one terminal each;
  record main, renderer and app server working sets on Windows (here) and
  macOS (CI artifact run by the owner); publish the figures in §18.
- Manual passes (§18) on Windows and macOS against an installed build.

#### Task S4.6: docs

- `docs/desktop.md`: install per platform, the macOS quarantine step for an
  unsigned app (`xattr -dr com.apple.quarantine /Applications/KnightCode.app`),
  SmartScreen's "More info → Run anyway", updates, where logs live.
- desktop-shell.md §15 S4 status; §18 figures.

### Phase S2c — the file panel

Branch `feat/desktop-file-panel` on top of S4, one PR. The owner's smoke test
found S2b's read-only file tab short of a full file panel (2026-10-24: an
"Open file" tab, a comparison toolbar, inline changes, a sectioned file tree).
Built on libraries that are already dependencies: `@pierre/diffs`
(`CodeView`, `EditProvider`) and `@pierre/trees`.

#### Task S2c.0: protocol

- `file/list {threadId, path?}` → `{root, entries: {path, type: "file" |
  "directory"}[]}`: one folder's entries, `path` relative to the thread's cwd
  (default: the cwd itself), hidden files included so the tree shows `.git`
  and `.gitignore`; at most 5,000 entries with `truncated`. `root` is the cwd;
  entry paths are relative to it.
- `file/read` gains `mtimeMs`; `file/write {threadId, path, text,
  expectedMtimeMs?}` → `{mtimeMs}`, refusing with `fileChanged` when the
  file's mtime is not the expected one.

#### Task S2c.1: the Files tab and the tree

- Tools grid: "Files" with the Search Files shortcut, Mod+P
  (`desktop.files.open`), opening the thread's one "Open file" tab
  (`PanelTab {kind: "files"}`, one per thread): the empty state "Open file" /
  "Select a file from the workspace tree" beside the tree, its filter focused.
- The tree (`@pierre/trees`, sectioned): "Filter files…" with Clear; "All
  changes" (opens the Changes tab); "Changed files" (the comparison's files,
  with git status colours and badges); "All files" (the cwd, one `file/list`
  per expanded folder, kept 5 s, file-type icons). A filter searches the
  workspace (`file/search`): "Searching files…", "No matching files".
  Selecting a file opens it in a tab (a preview tab, double-click keeps it),
  the active file selected in the tree.

#### Task S2c.2: the file tab

- Toolbar, in order: breadcrumb; comparison (Unstaged ▾ with Index "Unstaged
  changes", HEAD "Uncommitted changes", a Branch submenu of `git/branches`,
  and ✕ "Hide changes"; hidden, a "Show changes" button for the first
  comparison that changes the file); change navigation (previous, "1/3",
  next); file controls (diff layout while changes show, Toggle file tree;
  under 625px folded into "File controls"); the Open split. A "Search in
  files" control would search text across the workspace, which nothing here
  does yet; left out.
- Body: `FileDiff` of the comparison's side (`thread/diff/read` for the
  scope's trees, `thread/diff/file` for the file) against the file as it is,
  `expandUnchanged`, unified or split, word diffs; the plain file when changes
  are hidden or there are none. The tree on the right (toggled, remembered).
  Opened from a list of changes, the tab takes its comparison and reveals the
  first change.
- Find in file (Mod+F): the pierre editor keeps pierre's keymap, so Mod+F in a
  code file opens pierre's search panel (case, word, regex, previous, next).
  Done.

#### Task S2c.3: editing

- `EditProvider` over the file: edits mark the tab, Mod+S writes it
  (`file/write` with the read's mtime; a changed file is "Could not save
  file"), closing or switching with unsaved edits asks "Discard file
  changes?" / "Your unsaved changes to this file will be lost" / "Continue
  viewing" / "Discard changes"; files over a size limit open read-only
  ("Large file opened read-only").
- Done: autosave (3 s after the last edit) and Mod+S both write; closing saves
  first and asks to discard only when the write fails; a draft lives on the
  tab (the store), so switching away keeps it. A read-only state for files
  over 10 MiB has no case here, since `file/read` (2 MiB) never hands one
  over. A draft over a file that moved under it is not merged: that save is
  refused and the draft kept.

#### Task S2c.4: the rest of the file viewer

- Markdown "View preview" / "View source"; Go to line (Mod+G); breadcrumb
  folders listing their contents; word wrap; copy path options. Git blame and
  pull-request review comments stay out (no review-comment backend).
- Done: Go to line is Mod+L (it shares the key with the preview's address
  bar, which has no binding here), a 200px "Line" field with "1–N" and "Enter
  a valid whole line number"; each breadcrumb folder opens a 320px panel of
  that folder's tree, its active path expanded; Markdown reads rendered by
  default and as source when opened with a comparison. Word wrap and copy
  path controls are left out (the Open menu's are S2b's).

#### Validation

- Each task: tests for its server methods and pure helpers, and a pass over
  CDP in the running app.

### Phase D — the TUI on the app server

Starts after S4 ships. One PR per slice, each leaving the TUI working.
`interactive-mode.ts` and its components change only where a slice says so;
every such hunk is listed in the slice's PR description so a later resync can
find it. D0's inventory is reviewed before D1 starts, and may re-cut D1-D5:
the code will have moved by then (resyncs), and D0 is where the remaining
unknowns are settled.

#### Task D0: bootstrap, local handles, facade, inventory

- Inventory (into the ledger, before code), each item mapped to an action
  (a protocol method), a read (a local handle) or local state that stays:
  - every `this.session.*`, `this.runtimeHost.*` and `this.runtime.*`
    reference in `interactive-mode.ts` (194 on 2026-10-23; the 26
    `modelRuntime` and 13 each of `resourceLoader` and `extensionRunner`
    among them), every `this.sessionManager.*` and `this.settingsManager.*`
    reference (the getters at 609 and 612; `getCwd` 16 times), and every
    component taking a session;
  - every CLI flag that reaches interactive mode (`main.ts` parsing through
    `createAgentSessionRuntime` at 906, the session options passed at
    882-893), each mapped to `thread/start` or `thread/resume` params, a new
    `ThreadManagerOptions` field, or local state. `--no-session` (an
    in-memory session; app server threads are files) and any flag with no
    server equivalent are listed with the change they need;
  - the startup work `main.ts:912-1000` does for interactive mode
    (diagnostics, model fallback message, theme, capability overrides,
    deprecation warnings) and where each moves.
- Bootstrap: interactive mode builds the server as `entry.ts:65-105` does
  for stdio, over `createInProcessPair()`: `createAppServerContext`, a
  `ThreadManager` with the CLI's options, and an `AppServer` with `mode:
  "tui"` and `appServerHandlers(ctx, threads)`. The direct runtime of
  `main.ts:906` is no longer built for interactive mode (one owner of the
  session). The selected session (`--continue`, `--resume`, `--session`, or a
  new one) opens with `thread/resume` or `thread/start`. Print and RPC modes
  keep today's path (D12).
- Local handles (arch §7.3), offered only on the in-process transport
  (`initialize.capabilities.localHandles`, `protocol.ts:565`; refused with
  `invalidParams` over stdio):
  - session events: the connection's `subscribe(threadId, listener)` gets
    the thread's own `AgentSessionEvent` objects, as `AgentSession.subscribe`
    delivers them, with no encoding;
  - reads: a read-only view of the thread's `SessionManager` (entries, leaf,
    cwd, name, `buildContextEntries`), `getSessionStats()`,
    `getContextUsage()`, and the model, resource and extension reads the
    inventory lists. Read-only by type: the view exposes no method that
    appends or moves the leaf;
  - UI: the TUI's own `ExtensionUIContext` is bound as the UI of every
    thread the in-process connection holds, in place of `dialogs.ts`'
    protocol context (`threads.ts:2064` notes this is not built), so
    `getEditorText()` and the other synchronous members
    (`core/extensions/types.ts:259,303-315`), factories and dialogs work as
    today.
- `modes/interactive/remote-session.ts` (new): `RemoteSession`, the members
  `InteractiveMode` uses. In D0 every member forwards to the live session
  through the handles, actions included, so the TUI works unchanged on the
  new bootstrap. The members still on the handle are a typed list in the
  file; each slice moves its actions off it. `interactive-mode.ts` swaps its
  `AgentSession`, `AgentSessionRuntime` and `SessionManager` types for the
  facade's.

#### Task D1: turn lifecycle (slice 1)

- `prompt` → `turn/start`, `steer` → `turn/steer`, `followUp` →
  `turn/queue/add`, `abort` → `turn/interrupt`, `clearQueue` →
  `turn/queue/clear` (new, arch §7.2). `isStreaming`, `isIdle` and
  `waitForIdle` stay reads of the live session.
- Queue reads move with the queue. Follow-ups queued through the server live
  in `LoadedThread.queued` (`loaded-thread.ts:58-62`: "not in the agent's
  queue"), so the session's `getFollowUpMessages()` and
  `pendingMessageCount` (`agent-session.ts:2599-2610`) no longer see them.
  The facade answers those reads, which `getAllQueuedMessages`
  (`interactive-mode.ts:4696-4707`) draws, from the latest
  `turn/queue/updated` (`steering` and `followUp`, `protocol.ts:971`). Test:
  a follow-up queued during a turn shows in the pending display, leaves it
  when its turn starts, and returns to the editor when a stop drops the
  queue, as today.
- Approvals. A new TUI thread starts `fullAccess` (`threads.ts:189-191`),
  but a resumed thread keeps its stored mode (`threads.ts:1473-1474`;
  `test/app-server/approvals.test.ts:111`: a desktop thread made with the
  default resumes as `ask` on a terminal connection), and a client with no
  handler answers `item/toolCall/requestApproval` with `methodNotFound`
  (`app-server/client.ts:133-136`). So before turns move onto the protocol,
  the in-process client answers that request: the TUI shows the server's
  `decisions` (arch §5.4) in its existing select dialog and returns the
  choice. A saved mode is never widened to `fullAccess`.
- Withdrawals: `serverRequest/cancelled` carries only the request id
  (`protocol.ts:984`), and `AppServerClient.onRequest` hands a handler only
  the params (`client.ts:68-75`, called at 139). So the handler gains a
  second argument, `{ id, signal }`, the signal aborted when the client
  receives `serverRequest/cancelled` for that id; the TUI's dialog closes on
  it. Tests: a resumed `ask` thread asks before a `bash` call in the TUI and
  runs it once allowed; an interrupt withdraws the dialog; a cancellation
  for an old request id never closes a newer dialog.

#### Task D2: model, thinking, settings (slice 2)

- `setModel`, `setThinkingLevel`, `cycleModel`, `cycleThinkingLevel`,
  scoped models, steering and follow-up modes, auto-compaction, cache
  warming: `thread/settings/update` fields (new, arch §7.2). Settings that
  only change how the TUI draws (`getShowImages`, `getOutputPad`, ...) stay
  on a local `SettingsManager` over the same files; settings writes go
  through `config/write`.

#### Task D3: the session tree (slice 3)

- `thread/tree/navigate`, `thread/clone`, `thread/export`, `thread/import`
  (new, arch §7.2); new, resume, fork, compact, rename onto the existing
  methods. The tree is read through the session-manager handle (no
  `thread/tree/read` needed in-process). The lock clash offers a fork
  (arch §5.5), as the desktop does.

#### Task D4: commands, bash, retry (slice 4)

- `!` and `!!` → `shell/exec`, `shell/abort` (new); slash commands, prompt
  templates and skills through `turn/start`'s input handling;
  `abortRetry` → `turn/retry/abort` (new). `/session` statistics stay
  `getSessionStats()` through the handle, so every `SessionStats` field
  (`totalMessages`, `userMessages`, `toolCalls`, ...,
  `interactive-mode.ts:6736-6739`) is kept.

#### Task D5: the last actions, and done

- Whatever actions the inventory found beyond D1-D4 (extension command
  actions such as `newSession`, `fork`, `navigateTree`, `switchSession` and
  `reload` from `bindExtensions`' command context) move to protocol calls.
- Done when the facade's handle list holds reads only, `rg -n
  "AgentSession\b|AgentSessionRuntime\b" packages/cli/src/modes/interactive`
  matches only `remote-session.ts`, and the TUI test suite passes.

#### Task D6: docs, changeset per slice

- arch §7 status per slice; `docs/tui.md` where behaviour visible to users
  changes; a changeset only for such a slice (arch §10).

---

## 6. File manifest

| Phase | New | Changed |
| --- | --- | --- |
| S2b | `cli/src/app-server/files.ts`, `desktop/src/main/open-in.ts`, `desktop/src/renderer/components/file-tab.tsx`, tests | `protocol.ts`, `app-server.schema.json`, `diff.ts`, `workspaces.ts`, `threads.ts`, `host-protocol.ts`, `host.ts`, `store.ts`, `thread-view.tsx`, `changes.tsx`, `git.tsx`, `activity.tsx`, `keybindings.ts`, docs, changeset |
| S3 | `desktop/src/main/{terminals,preview,mcp-apps}.ts`, `renderer/components/{terminal,preview,mcp-app}.tsx`, `renderer/mcp-app-bridge.ts`, `cli/src/app-server/mcp-apps.ts`, `examples/mcp-app/`, tests | `main.ts`, `router.ts`, `host.ts`, `host-protocol.ts`, `vite.main.config.ts`, `forge.config.ts`, `package.json` (deps), `bun.lock`, `styles.css`, `store.ts`, `thread-view.tsx`, `activity.tsx`, `composer.tsx`, `keybindings.ts`, `mcp/src/protocol/types.ts`, `extensions/mcp/{tools,index}.ts`, `threads.ts`, `transcript.ts`, `item-mapper.ts`, `protocol.ts`, docs, changeset |
| S4 | `desktop/scripts/stage-server.ts`, `desktop/src/main/updates.ts`, `desktop/assets/*`, `apps/web/app/api/desktop/update/...`, `apps/web/lib/desktop-release.ts`, `.github/workflows/desktop-release.yml`, `desktop/test/e2e/*.e2e.ts`, `desktop/playwright.config.ts` | `forge.config.ts`, `package.json`, `.gitignore`, `main.ts`, `server.ts`, `host.ts`, `host-protocol.ts`, `settings.tsx`, `store.ts`, `ci.yml`, docs |
| D | `cli/src/modes/interactive/remote-session.ts`, tests | `protocol.ts` (arch §7.2 methods), `app-server/*` (local handles, tree, shell, settings, `ThreadManagerOptions`), `in-process.ts`, `server.ts`, `main.ts` (interactive bootstrap), `interactive-mode.ts` (listed hunks), docs |

---

## 7. Required tests

S2b:

- `file/read`: a relative path resolves against the thread's cwd; a
  directory answers `invalidParams`; a NUL in the first 8 KiB is `binary`; a
  file one byte over `maxBytes` is `tooLarge` with no text.
- `thread/diff/file` with a read's trees returns the sides that read
  diffed, for every scope: applying the read's hunks to `old` gives `new`
  (over the fixture repos of `diff.test.ts`); a rename reads `oldPath`; a
  file edited on disk after the read still returns the read's contents; a
  tree id the repository lacks answers `invalidParams`.
- Handoff `dryRun`: each refusal that does not depend on a destination
  still to be created (operation in progress, submodules, an invalid branch
  name, `branchExists`, a local thread's missing HEAD, and for a worktree to
  local handoff, local changes in the main checkout and ignored files in the
  way) answers the same error as the real call; a clean case answers success and
  leaves the repos, the worktree root, the agent dir's `handoff/` directory
  and the thread unchanged (compared by `git status --porcelain`,
  `git worktree list` and directory listings). The real handoff still
  passes `handoff.test.ts` unchanged after the extraction.
- `detectTargets` with a fake PATH and fake install directories finds each
  editor once, prefers the real exe over a `.cmd` shim, and builds each goto
  syntax; `host/openIn/open` with an unknown id answers `invalidParams`.
- Store: a 13th file tab closes the least recently active one; Changes
  cannot close.

S3:

- Terminals (main, a fake `node-pty`): output past 64 KiB keeps the last 64
  KiB; `attach` returns it; data reaches only attached windows; `killThread`
  runs on `thread/archived` (archived) and `thread/deleted` and not on
  unarchive; a cwd that is not a directory answers `invalidParams`.
- One real PTY test per platform in CI (echo through the default shell):
  Windows and Linux in `ci.yml`, macOS in the release workflow's
  darwin-arm64 leg.
- Webview guard: a partition outside the pattern, a `file:` src and a
  `preload` are refused or stripped; `capture` refuses a guest of another
  window.
- MCP App store: a URL serves only its own HTML at `/index.html`, 404
  elsewhere; the CSP carries the declared domains and nothing else, with
  `frame-ancestors` the dev origin under Vite and `app://desktop` packaged;
  an entry with `;`, whitespace, a keyword, a path or another scheme answers
  `invalidParams`; release and window close remove it.
- Bridge bounds: `callTool` with 1 MiB + 1 of arguments, and a fake server
  returning a 5 MiB result, each answer `invalidParams` while the
  connection stays up and the next request succeeds. In the bridge (jsdom),
  an app request past 1 MiB, one past 64 MiB included, gets `-32602` with
  nothing sent to the client, and the next request goes through.
- Preview: address-bar input `file:///etc/hosts` never reaches `loadURL`;
  a `will-redirect` to `file:` is prevented.
- Bridge (jsdom): a message from another source or origin is ignored;
  nothing reaches the frame before `ui/notifications/initialized`, then
  `tool-input` comes before `tool-result`, each once; an interrupted item
  sends `tool-cancelled`; unmounting sends `ui/resource-teardown` while the
  iframe is still connected (`isConnected`), removes it and releases on
  the answer or after 1 s without one; `tools/call` reaches
  `mcp/app/callTool`; `approvalRequired` shows the confirm and retries with
  `confirmed` only after it; `ui/open-link` refuses `javascript:`;
  `ui/request-display-mode` for `pip` answers the current mode; an unknown
  method and `ui/update-model-context` answer `-32601`.
- Server gate: `fullAccess` runs a write tool; `ask` answers
  `approvalRequired` for it and runs it with `confirmed`; a `readOnlyHint`
  tool runs in every mode; a tool of another server, or one whose visibility
  leaves out `"app"`, answers `invalidParams` in every mode.
- `details.mcpApp` reaches the item on the live and read-back paths
  (`transcript.ts`, `item-mapper.ts`), as Phase C's view tests do; a result
  over 256 KiB is stored as `resultOmitted`.
- MCP extension against `examples/mcp-app`: the capability is advertised in
  the `"desktop"` mode and not in `"tui"`; an app-only tool is hidden from the
  model; `readResource` returns the HTML resource; with the server at the
  default `codemode` exposure, and again with `codemode.mode: "only"`, the
  UI tool is declared `model-only`, a codemode script cannot call it, and
  its `mcpApp` survives an unload and `thread/resume`; a UI tool the config
  hides stays hidden; with discovery inside the startup bound (a gated fake
  server), a codemode server's UI tool is in the first request.

S4:

- Feed route: drafts and prereleases are skipped; the newest `desktop-v*`
  by semver wins over a newer CLI release; `RELEASES` lines point at the
  release's assets; darwin answers 204 at the current version.
- `stage-server.ts`' version check fails on a mismatch.
- End to end: section 5, Task S4.4.
- Overlapping resumes: the older result is dropped with no unsubscribe and
  no hold released, in both response orders; later notifications and an
  approval still reach the window.

D:

- Local handles exist only in-process: `initialize` with `localHandles`
  over stdio answers `invalidParams`, and no handle is reachable there.
- A facade subscriber receives the same `AgentSessionEvent` objects, in the
  same order, as a direct `AgentSession.subscribe` on that thread
  (identity, not equality).
- The session-manager view exposes no appending or leaf-moving member (a
  type test), and reads match the session file after a turn, a compaction, a
  `!` command and a tree move.
- UI: an extension's `ctx.ui.getEditorText()` on a thread the in-process
  TUI holds returns the TUI editor's text synchronously; a factory widget
  and a `custom` dialog render as today.
- Bootstrap: `--continue`, `--resume`, `--session`, `--model`,
  `--thinking`, `--tools`, `-e` and `--no-mcp` each reach the thread the TUI
  opens (suite harness, faux provider), and D0's flag map has a test per
  flag group it maps.
- Every slice: the TUI tests for that area pass on the in-process path
  (`test/interactive-mode-*.test.ts`, `test/suite/` with the faux provider),
  and an action the slice moved shows in the server (a `turn/start` makes a
  turn marker; a queued follow-up is the server's queue).

---

## 8. Exclusions

Do not add:

- `desktop.json`, a `desktop` package resource type, `kc-ext://`, an
  extension host process or `@knightcode/desktop-sdk` (D1).
- A sandboxed frame or SDK for the Changes pane, the terminal or the
  preview (D1).
- `WebContentsView` for the preview (D4).
- File reads, git or settings writes in main or the renderer (§17).
- Agent control of the preview (L3), pop-out tabs (L1), the pull request
  inbox (L8): each needs its own spec (§14).
- HTML from agent extensions (arch §8.2): MCP Apps come from MCP servers the
  user configured, never from an extension's `details`.
- An MCP App calling another server's tools, or a tool call that bypasses
  the gate.
- These parts of MCP Apps, each optional for a host: `ui/update-model-context`
  (it needs a way to put the app's context into the next turn's input, which
  is its own change to the app server's turn start), the `pip` display mode,
  `ui/notifications/tool-input-partial`, and the sandbox permissions
  (camera, microphone, geolocation, clipboard). The web-host sandbox proxy
  does not apply to a desktop host (D2).
- Code signing, notarization or a Store package (D7).
- A website download page (the release page serves v1).
- Moving print mode or `--mode json` (D12); changes to RPC mode.
- A dead-process lock takeover (Phase C cut it: safe identity needs a boot
  id; the 30 s stale lock stays).

---

## 9. Validation

From the repo root, per phase:

- `bun run check-types`; `cd apps/desktop && bun run check-types`.
- `cd apps/desktop && bun x vitest --run`; from `packages/cli`:
  `bun x vitest --run test/app-server/` and the touched test files; from
  `packages/app-server-protocol`: `bun x vitest --run`.
- `cd packages/cli && bun x vitest --run test/documentation.test.ts
  test/system-prompt.test.ts`.
- `bun run scripts/changelog-sections.ts`.
- `rg -n "kc-ext|desktop-sdk|utilityProcess" apps/desktop/src` → no matches
  (after S3).
- `rg -n "WebContentsView" apps/desktop/src` → no matches.
- `rg -n "nodeIntegration: true|contextIsolation: false|sandbox: false" apps/desktop/src`
  → no matches.
- `rg -n "event\.key ===|e\.key ===" apps/desktop/src/renderer` → matches
  only in the keybinding dispatcher.
- `rg -c "#[0-9a-fA-F]{3,8}\b|rgb\(" apps/desktop/src/renderer --glob "!**/themes/**" --glob "!*.css"`
  → no TypeScript file above its count on 2026-10-23 (the old §18 grep
  already failed on `main`): `file-icon.tsx` 14, `appearance.ts` 11,
  `icons.tsx` 5, `settings.tsx` 2, `activity.tsx`, `approval.tsx`,
  `changes.tsx` 1 each, every other file 0. Colours are defined only as
  tokens in the stylesheets (`styles.css`, `diff-overrides.css`), which may
  grow (the terminal's ANSI tokens, S3.3). desktop-shell.md §18 states the
  same rule.
- S4: `cd apps/desktop && bun x playwright test`; the release workflow run
  on a `-rc` prerelease draft, every target smoke-tested in CI except
  darwin-x64, which is cross-built with no Intel runner (as the CLI's
  darwin-x64 binary is, AGENTS.md "Changelog and Releasing"); the owner
  smoke-tests it on an Intel Mac when one is available, and the release notes
  say when it was not.
- D: `rg -n "AgentSession\b|AgentSessionRuntime\b" packages/cli/src/modes/interactive`
  → only `remote-session.ts`; `rg -n "AgentSessionRuntime" packages/cli/src/modes/print-mode.ts`
  → still matches (D12).

---

## 10. Stop condition

The desktop app v1 and the terminal migration are complete when:

- Every item of desktop-shell.md §19 (as amended) holds: it installs and
  updates on Windows, installs on macOS (ad hoc signed, update banner) and
  Linux, with the bundled binary and no PATH dependency.
- A thread shows file tabs, opens files in a detected editor, expands
  hunks, and refuses a handoff before the user confirms it.
- A thread has terminals in its cwd that survive a reload and end with the
  thread; a preview tab loads a local server and Annotate attaches a capture.
- An MCP server's app (`examples/mcp-app`) draws inline, calls its own
  tools through the gate, and opens full screen in the side panel.
- The release workflow drafts a release with installers for every target,
  and an installed Windows build updates itself from the next draft once
  published.
- The end-to-end suite passes on Windows and Linux CI, and §18's memory
  figures are recorded.
- Interactive mode runs on the in-process app server with the D5 grep
  satisfied, its tests green, and print, JSON and RPC modes unchanged.

---

## Open items for the user

- S3.0: approve `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` (versions
  and install scripts recorded in the probe).
- S4.0: permission to run `build:binary` locally for packaging tests.
- S4.4: approve `@playwright/test`.
- S4.2: the Vercel production redeploy of the feed route (the owner runs
  production deploys).
- S4.5: a macOS manual pass needs a Mac.

---

## Review history

- v1 to v2 (2026-10-23): code references checked against the code; MCP
  Apps parts checked against the spec (Stable 2026-01-26): lifecycle order,
  the required tool and teardown notifications, display modes, CSP fields,
  visibility, app-only tools, `structuredContent` kept in `details`; the
  colour grep baseline; preview key forwarding.
- Round 1 (KnightCode, read-only): 7 blockers, 9 major gaps, 3 wrong
  references, all accepted after checking each against the code. Handoff dry
  run through an extracted `planHandoff`; hunk expansion through
  `PatchDiff`'s `loadDiffFiles` with the read's tree ids; the resume guard
  drops stale results without unsubscribing; UI tools exposed directly, not
  through codemode; the release workflow builds the bump commit with its
  lockfile; darwin-x64 smoke test stated consistently; Phase D redesigned
  around in-process local handles (D11), with D0's inventory reviewed before
  D1; spec contradictions (arch §7.1 slice 1, §7.2 statistics, §8.3, shell
  §11.1 and §18) fixed.
- Round 2 (KnightCode): 5 blockers, 4 major gaps, 2 wrong references, all
  accepted after checking. UI tools get the existing `model-only` exposure
  (not `direct`, which codemode can still call), respecting `hidden`, with
  the desktop's startup wait covering codemode servers; Phase D answers
  approvals of resumed `ask` threads; the resume-guard test and arch
  §13-14's print-mode criteria aligned; Open-in uses the shell's
  `targets`/`targetId` contract; the dry run's limits for a new worktree
  stated; the handoff check reruns on branch edits; hunk expansion's
  fallback and per-read identity are ours; comment anchors and the ANSI
  palette described correctly.
- Round 3 (KnightCode): 1 blocker, 5 major gaps, 1 wrong reference, all
  accepted after checking. D1's queue reads follow the server-owned queue
  (`turn/queue/updated`); a failed hunk load drops `loadDiffFiles` so no
  control remains; MCP App `frame-ancestors` from main's trusted origin;
  bridge arguments and results bounded under the transport limits; CSP
  entries validated; `onRequest` handlers get `{id, signal}` for
  withdrawals; the arch extension-UI row and the shell's host table updated.
- Round 4 (KnightCode): 3 blockers, 3 major gaps, all accepted after
  checking. The preview's address bar checks URLs before `loadURL` (which
  `will-navigate` never sees) and main adds `will-redirect`; the bridge
  bounds forwarded params before stdin; the desktop package gets an
  `author` for Squirrel's `authors`; MCP App teardown keeps the iframe alive
  in a holder until the answer or 1 s; e2e files are `*.e2e.ts` with a
  Playwright config; macOS runs the real PTY test in the release workflow.
- Round 5 (KnightCode, blocker-only, final): 1 blocker, accepted after
  checking `@electron/osx-sign` and `@electron/packager`: ad hoc signing
  needs `identityValidation: false`, `continueOnError: false` makes a
  signing failure fail the build, and the macOS legs verify the signature.
  Round 4's fixes held.
