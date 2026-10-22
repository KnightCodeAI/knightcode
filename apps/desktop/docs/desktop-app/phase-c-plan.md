# Phase C (extension UI over the protocol): implementation plan

Status (2026-10-22): v9, final: review round 9 rated it ready. Nothing
implemented. Branch `feat/extension-ui-views`, off `main` at `2b530ac19`; the
implementation lands as one PR on it. No commits are authorized by this plan.

**Goal:** An agent extension's status text, title, working message and widgets
reach the desktop app over the app server protocol, as they reach the
terminal today. Extensions get declarative views (`View`, architecture.md
section 8.2) for widgets, tool results and extension messages, drawn by both
clients from the same data. Buttons and fields in a widget answer back to the
extension.

**Architecture:** One protocol module, `view.ts`, defines `View` and the one
function that decides whether a value is an acceptable view. The app server
keeps each loaded thread's extension UI (statuses, title, working message,
widgets) in `dialogs.ts`, sends changes as `ui/state` and `ui/widget`, and
hands the whole state to a client in the `ui` field of the result that opens
the thread. A widget control's press arrives as the request `ui/event` and goes
to every handler the thread's extensions registered with `ctx.ui.onViewEvent`.
Tool results and extension messages carry `details.view` into their items on
the live and read-back paths through one function. The terminal draws a view
with `ViewComponent`, built from existing TUI components. The desktop renders
the same data with its existing components and theme tokens. The extension
runner is not changed: its one shared UI context stays, and every `ui/*`
message is keyed by thread and key only.

**Spec:** architecture.md sections 4.5, 5.9, 8 and 10 (as amended on this
branch), 11 and 12; desktop-shell.md sections 8 and 9.3 (as amended). "§"
below means architecture.md.

---

## 0. Mandatory reading

Read completely before editing:

1. `AGENTS.md`: "The Core Constraint", Code Quality, Commands.
2. architecture.md §4.5 (subscriptions, the resume commit), §5.9 (transport
   limits), §8 (all), §10 Phase C, §11, §12.
3. desktop-shell.md §8 (extension UI), §9.3 (thread view, tool rows), §10
   (keybindings), §11.2 (tokens).
4. `packages/app-server-protocol/src/protocol.ts` and
   `test/protocol.test.ts`.
5. `packages/cli/src/app-server/dialogs.ts` (all), `approvals.ts:68-113`
   (`askSubscribers`), `loaded-thread.ts` (all), `server.ts:35-49,236-273`
   (`Commit`, notifications, the send), `history-pages.ts:47-91`
   (`pageHistory`), `transcript.ts` (all), `item-mapper.ts:283-349`.
6. `packages/cli/src/app-server/threads.ts`: `start` (782-855), `resume`
   (857-883), `fork` (the end, 1192-1201), `subscribe` (1265-1271), `relocate`
   (743-763), `replace` (2031-2040), `bind` (2043-2105), `handlers()` (from
   2240).
7. `packages/cli/src/core/extensions/types.ts:110-301` (`ExtensionUIContext`),
   `runner.ts:332-363` (`noOpUIContext`), `:577-591` (`setUIContext`,
   `wrapUIPromptContext`), `:888-903` (`createContext`).
8. `packages/cli/src/modes/rpc/rpc-mode.ts:133-230`: how RPC maps
   `setStatus`, `setWidget` and `setTitle` onto a wire protocol, and ignores
   factories.
9. `packages/cli/src/modes/interactive/interactive-mode.ts:2317-2323`
   (`setExtensionStatus`), `:2380-2412` (working row, hidden thinking label),
   `:2417-2535` (widgets), `:2648-2700` (`createExtensionUIContext`);
   `components/footer.ts:14-20,217-225` (status text and order);
   `components/tool-execution.ts` (all); `components/custom-message.ts` (all).
10. `packages/cli/src/core/system-prompt.ts:162-169` and
    `packages/cli/test/system-prompt.test.ts`.
11. `packages/cli/docs/app-server.md` "Dialogs" (288-312) and "Limits"
    (735-759); `docs/desktop.md`; `docs/extensions.md:383-399`;
    `docs/docs.json`; `test/documentation.test.ts`.
12. Desktop: `apps/desktop/src/main/router.ts` (all),
    `src/renderer/store.ts:296-760`, `components/thread-view.tsx`,
    `components/composer.tsx:100-160,435-540`, `components/items.tsx:237-297,
    476-569`, `components/activity.tsx:330-412`, `renderer/activity.ts:440-443`,
    `components/markdown.tsx`, `components/button.tsx`, `components/switch.tsx`,
    `components/menu.tsx`, `components/tooltip.tsx`,
    `src/shared/keybindings.ts`, `renderer/styles.css` (the `@theme inline`
    block at 290 and the `kc-*` classes), and
    `apps/desktop/test/renderer/store.test.ts`.

## 1. Problem

A desktop thread binds `desktopDialogs(thread)` as its UI context
(`threads.ts:2048`), so `ctx.hasUI` is true and dialogs work. Everything else
an extension draws is dropped without a trace (`dialogs.ts:61-72`):

```ts
		notify: (message, level = "info") => thread.notify("ui/notify", { threadId: thread.id, message, level }),
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
```

A short trace: a test-watcher extension calls
`ctx.ui.setStatus("tests", "✓ 42 passed")` and
`ctx.ui.setWidget("tests", ["2 failing: parser.test.ts"])`. In the terminal
the status joins the footer (`footer.ts:221-225`) and the widget sits above
the editor (`interactive-mode.ts:2417-2457`). In the desktop app neither
appears, and nothing in `app-server.log` says why.

There is also no way to say more than lines of text, in either client:

- `setWidget` takes lines or a terminal component factory
  (`types.ts:188-194`). A factory cannot cross a process, so a desktop client
  can never draw it.
- A tool result's `details` are dropped apart from file changes
  (`transcript.ts:204-215`, `item-mapper.ts:337-347`), and the protocol's
  tool call item has no `view` (`protocol.ts:330-341`), so the desktop shows a
  tool's raw text output (`activity.tsx:331-350`). Custom messages keep only
  their text (`transcript.ts:148-155`, `item-mapper.ts:287-305`).
- `ClientNotifications` holds only `initialized` (`protocol.ts:900`), and
  `ExtensionUIContext` has no way to receive a press, so a widget cannot have
  a button.

Two facts about delivery shape the design (decision D2 and D3):

- `thread/resume` subscribes inside its commit, in the step that writes the
  response (`threads.ts:864-882`, `server.ts:261-262`), and the desktop's
  main process routes a thread's notifications only to windows whose holding
  response has already passed through it (`router.ts:158-166, 230`). A
  notification sent at subscribe time therefore reaches no window that is
  opening the thread: a second window resuming a held thread never sees it,
  and neither does a new thread's window (`store.ts:749-758` builds the view
  from the `thread/start` result).
- The router drops every notification a window sends (`router.ts:141`), and
  `AppServer` dispatches no client notification but `initialized`
  (`server.ts:236-249`).

## 2. Decisions

| # | Question | Decision | Rejected, and why |
| --- | --- | --- | --- |
| D1 | Attribution | Key only, as the terminal and RPC mode. Statuses and widgets are keyed by their key alone; no `ui/*` message names the extension. The runner keeps its one shared UI context (`runner.ts:368, 577, 888`) | A per-extension UI context in the runner: it changes core extension code, and neither existing client needs it. Two extensions using one key overwrite each other, as in the terminal; the docs say to prefix keys |
| D2 | How a client that opens a thread learns its current UI | The results of `thread/start`, `thread/resume` and `thread/fork` carry a required `ui: UiSnapshot`, read in the same synchronous step that writes the response (`commitOnSend`, as resume's `queue`). `ui/state` and `ui/widget` then carry changes. A client that sees `thread/replaced` resumes the new thread (the desktop already does, `store.ts:410-425`) and gets its `ui` there | Replaying the state as notifications when a connection subscribes: they leave before the response that subscribes, so the desktop router drops them for a window still opening the thread (section 1). Sending them after the response needs a post-send hook in `AppServer`, and every `turn/start` would resend every widget |
| D3 | How a widget control answers | The client request `ui/event {threadId, widgetKey, id, value?}` → `{}` | A client notification, as §8.2 had it: the router drops window notifications and `AppServer` has no dispatch for them (section 1), so both would need new paths, and a failure would be silent. A request reuses `Handlers`, the schema check and the router's forwarding, and tells the sender when the thread is gone or the value is invalid |
| D4 | Which handlers receive an event | Every handler registered on the thread with `ctx.ui.onViewEvent`; the event carries `widgetKey`, and each handler checks its own keys | Routing by extension: it needs the per-extension UI context D1 rejects |
| D5 | Where controls are live | Only in widgets on the desktop. Views in tool rows and extension messages draw buttons and fields disabled; terminal views draw them as text | Live controls in the transcript: a tool result read back from yesterday has no running code waiting for its press. In the terminal, transcript renderers (`renderResult`, message renderers) are display-only too, and widgets sit outside the TUI's focus chain |
| D6 | Terminal-only UI on the desktop | A widget factory, `custom`, `onTerminalInput`, `setWorkingIndicator` with options, and `setHeader`/`setFooter` with a factory each write one line to stderr (`app-server.log`) per method per thread load, naming the method (and the widget key) | Once per extension: there is no extension name (D1). Every call: a widget redrawn each second floods the log. A `warning` toast: users install terminal extensions on purpose, and a toast on every thread they open is noise |
| D7 | Widget placement on the desktop | `placement` travels on the wire. The desktop shows one panel above the composer: `aboveEditor` widgets first, then `belowEditor` ones, each group in the terminal's order (the last one set comes last) | A second panel below the composer: it would sit between the input and the footer's branch row, which Codex keeps for git status. The terminal and a Phase D client still get the placement |
| D8 | `setWorkingVisible`, `setWorkingMessage`, `setHiddenThinkingLabel` | `workingVisible: false` hides the desktop's waiting row (the shimmering "Thinking" under a running turn, `items.tsx:525-528`), the terminal's working loader; `workingMessage` replaces that row's text. `setHiddenThinkingLabel` is not sent: desktop reasoning rows have no hidden-thinking state, they are always a collapsible "Thinking"/"Thought" row as in Codex | A hidden-thinking label on the desktop's reasoning rows: no consumer, and it would change Codex's look |
| D9 | `setTitle` on the desktop | The window title (`document.title`) while that thread is open in the window; "KnightCode" otherwise | Replacing the thread name in the header: the name is the user's own, renamed from the header, and an extension title would hide it |
| D10 | Validating views at the trust boundary | `view.ts` holds the TypeBox schema (unknown members rejected, as every protocol object) and `checkView(value, maxBytes)`, which first copies the value through `JSON.stringify` and `JSON.parse` and then checks the copy: the byte budget, at most 8 levels of stacks and lists, the schema, unique control ids, table rows as wide as the columns, a field value that fits its kind and options. It returns that copy, and the copy is what the server stores and sends. The terminal uses the same function | Checking in each renderer: a malformed view would cross the wire, and every client would need its own copy of the rules. Checking the extension's object and sending its serialization: an inherited `toJSON`, a getter or a later mutation makes what is sent differ from what was checked, and a cycle or a very deep value overflows the stack inside the schema check |
| D11 | Sizes | Views in tool results and extension messages: at most 64 KiB serialized (the inline item limit, §5.9). A widget's lines or view: at most 16 KiB, at most 16 widgets, at most 50 statuses; status and widget keys 1 to 128 characters; status text, title and working message cut to 200 code points (the thread title limit, `loaded-thread.ts:24`). `pageHistory` counts `ui` in a resume page's 1 MiB budget. A refused widget or status gives one warning per key per load: a `warning` notification, or a load warning in the opening result while the thread has no subscriber (as extension errors during load, `threads.ts:2049-2053`) | No limits: one extension's widgets, or one very long key, could make a resume response pass the 1 MiB page budget, which `pageHistory` answers with `internal` (`history-pages.ts:64-66`), so the thread could not be opened |
| D12 | ANSI escapes | The server strips them (`stripAnsi`, `utils/ansi.ts:68`) from status text, title, working message and widget lines, and folds status text onto one line as the footer does (`footer.ts:14-20`) | An ANSI renderer in the desktop: a component for colours the theme should own. Views carry `tone`, not escapes |
| D13 | Views in the transcript | `viewOf(details)` in `transcript.ts` reads `details.view` for tool results and custom messages, on the live and the read-back path. An invalid view gives no `view`, and the raw output or markdown shows | A separate view entry in the session file: duplicate state. A `warning` for an invalid stored view: read-back of an old transcript would toast |
| D14 | The terminal | `ViewComponent` builds a view from `Text`, `Markdown`, `VStack`, `HStack` and `Gutter`. `setWidget(key, view)` draws it at its placement. A tool result's `details.view` replaces the raw-output fallback when the tool has no `renderResult`; a custom message's replaces the markdown in the default block when no message renderer is registered | A new widget toolkit. A view winning over `renderResult`: the tool author chose that renderer for the terminal |
| D15 | The extension API | `types.ts` gains a `setWidget(key, view)` overload, `ViewEvent`, and an optional `onViewEvent?(handler)` on `ExtensionUIContext`, present only where widgets are interactive (the desktop app). Type-only edits; the runner is unchanged | A required `onViewEvent`: RPC mode's context literal (`rpc-mode.ts:133`) would have to change, which §12 excludes. An extension event `view_event`: it changes the runner's `emit` and the event union, more core code for the same reach |
| D16 | `/reload` | The server drops the view handlers when the reload begins (the old runner is invalidated before settings and resources reload, `agent-session.ts:3897-3908`), and clears the thread's UI state and reported set in `session.reload`'s `beforeSessionStart` (`:3893, 3920-3922`): after the old extensions' `session_shutdown` handlers ran (which may still set a title, as `examples/extensions/titlebar-spinner.ts` does), before the new ones' `session_start`; or when the reload fails. It sends the clears, as the terminal's `resetExtensionUI` does (`interactive-mode.ts:2471-2498`) | Keeping state across a reload: a widget whose extension is gone would stay forever, and handlers from the invalidated runner would throw stale-context errors. Clearing before `session.reload()`: the outgoing extensions' shutdown handlers would set state again after the clear |

The ponytail comment on `TERMINAL_ONLY_COMMANDS` (`threads.ts:192-194`)
pointed at this phase. `/usage`, `/llama` and `/undo` open `custom()`
components, which stay terminal-only (D6), so the list stays and the comment
is updated to say so.

## 3. Ownership

`packages/app-server-protocol/src/view.ts` owns:

- the `View` schema and type, and the size and depth constants;
- `checkView`, the one definition of an acceptable view, which also makes
  the copy everyone downstream uses.

`packages/app-server-protocol/src/protocol.ts` owns:

- `ui/state`, `ui/widget`, `ui/event`, `UiSnapshot`, `Widget`, and `view` on
  `toolCall` and `extensionMessage` items.

`packages/cli/src/app-server/dialogs.ts` owns:

- `ExtensionUiState`: a loaded thread's statuses, title, working message,
  working visibility, widgets, view handlers, and what it already reported;
- the desktop UI context: cleaning, limits, validation, the notifications,
  the terminal-only reports, and dispatching `ui/event`.

`packages/cli/src/app-server/threads.ts` owns:

- `ui` in the start, resume and fork results; the `ui/event` handler; the
  clear before a reload.

`packages/cli/src/app-server/transcript.ts` owns:

- `viewOf`, shared by `readTurns` and `ItemMapper`.

`packages/cli/src/core/extensions/types.ts` owns:

- the `View` overload of `setWidget`, `ViewEvent`, `onViewEvent`. Nothing else
  in `packages/cli/src/core` changes apart from type exports and the one
  system-prompt docs entry.

`packages/cli/src/modes/interactive/components/view-component.ts` owns:

- drawing a view in the terminal, for widgets, tool results and custom
  messages.

The desktop renderer owns:

- the `ui` slice of each held thread in `store.ts`, and `sendViewEvent`;
- `components/view.tsx`: `ViewNode` and `WidgetPanel`;
- status chips and the window title (`thread-view.tsx`), the waiting row
  (`items.tsx`), views in tool rows (`activity.tsx`) and extension messages
  (`items.tsx`).

## 4. Interfaces

`packages/app-server-protocol/src/view.ts` (new):

```ts
import { type Static, type TSchema, Type } from "typebox";
import { Compile } from "typebox/compile";

// Its own two-line helper: importing protocol.ts here would make the two modules import each other.
const Obj = <P extends Record<string, TSchema>>(properties: P) =>
	Type.Object(properties, { additionalProperties: false });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Tone = Type.Union([
	Type.Literal("muted"),
	Type.Literal("accent"),
	Type.Literal("success"),
	Type.Literal("warning"),
	Type.Literal("error"),
]);

export const View = Type.Cyclic(
	{
		View: Type.Union([
			Obj({ type: Type.Literal("text"), text: Type.String(), tone: Type.Optional(Tone) }),
			Obj({ type: Type.Literal("markdown"), markdown: Type.String() }),
			Obj({
				type: Type.Literal("stack"),
				direction: Type.Optional(Type.Union([Type.Literal("vertical"), Type.Literal("horizontal")])),
				children: Type.Array(Type.Ref("View")),
			}),
			Obj({ type: Type.Literal("list"), items: Type.Array(Type.Ref("View")) }),
			Obj({
				type: Type.Literal("table"),
				columns: Type.Array(Type.String(), { minItems: 1 }),
				rows: Type.Array(Type.Array(Type.String())),
			}),
			Obj({
				type: Type.Literal("progress"),
				value: Type.Number({ minimum: 0 }),
				max: Type.Number({ exclusiveMinimum: 0 }),
				label: Type.Optional(Type.String()),
			}),
			Obj({ type: Type.Literal("button"), id: Id, label: Type.String() }),
			Obj({
				type: Type.Literal("field"),
				id: Id,
				kind: Type.Union([Type.Literal("text"), Type.Literal("toggle"), Type.Literal("select")]),
				label: Type.String(),
				value: Type.Union([Type.String(), Type.Boolean()]),
				options: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
			}),
		]),
	},
	"View",
);
export type View = Static<typeof View>;

/** Serialized UTF-8 bytes of a view in a tool result or an extension message: the inline item limit (§5.9). */
export const VIEW_MAX_BYTES = 65_536;
/** A widget's lines or view. With at most 16 widgets, a thread's `ui` stays far inside a 1 MiB resume page. */
export const WIDGET_MAX_BYTES = 16_384;
/** Nesting of stacks and lists, counting the outermost view as 1. */
export const VIEW_MAX_DEPTH = 8;

/** A copy of `value`, made through JSON and checked against every rule, or why it was refused. Never throws. */
export function checkView(value: unknown, maxBytes = VIEW_MAX_BYTES): { view: View } | { error: string };
```

`checkView` steps, in order, each refusal with its own message:

1. Copy: `json = JSON.stringify(value)` inside `try`. A cycle throws
   `TypeError` and a value 200,000 levels deep throws `RangeError` (probed
   2026-10-22 under Bun and Node); both are refused. A result that is not a
   string is refused too: `JSON.stringify(undefined)` returns `undefined`,
   which is the ordinary case of a tool result without `details.view`. An
   inherited `toJSON` or a getter shapes the copy, which is what every later
   step checks, so what is checked is what is sent.
2. Size: `new TextEncoder().encode(json).length` against `maxBytes` (works in
   a browser too), before parsing.
3. `copy = JSON.parse(json)`. Within 64 KiB a JSON text nests at most about
   2,600 levels, which parses without trouble (probed).
4. Depth: a walk over `children` and `items` arrays, refusing past
   `VIEW_MAX_DEPTH`. It runs before the schema because the compiled schema
   check recurses without a limit (a 200,000-deep value throws `RangeError`
   inside `Check`, probed).
5. The schema: `Compile(View)`, compiled once at module load.
6. A `button` or `field` id already used in this view; a table row whose cell
   count differs from `columns.length`; a `toggle` whose value is not a
   boolean, a `text` or `select` whose value is not a string; a `select`
   without `options` or whose value is not one of them; `options` on a `text`
   or `toggle`. `progress` values above `max` are allowed and drawn full.

The result's `view` is `copy`: nothing else holds a reference to it.

`packages/app-server-protocol/src/protocol.ts`:

```ts
import { View } from "./view.ts";

const WidgetPlacement = Type.Union([Type.Literal("aboveEditor"), Type.Literal("belowEditor")]);
/** A status or widget key; the server refuses longer ones (D11). */
const UiKey = Type.String({ minLength: 1, maxLength: 128 });
/** Sorted by key, as the terminal footer shows them. */
const UiStateFields = {
	statuses: Type.Array(Obj({ key: UiKey, text: Str })),
	title: Type.Optional(Str),
	workingMessage: Type.Optional(Str),
	workingVisible: Bool,
};
export const Widget = Type.Union([
	Obj({ key: UiKey, placement: WidgetPlacement, lines: Type.Array(Str) }),
	Obj({ key: UiKey, placement: WidgetPlacement, view: View }),
]);
export type Widget = Static<typeof Widget>;
/** A thread's extension UI as it stands; `widgets` in display order within each placement. */
export const UiSnapshot = Obj({ ...UiStateFields, widgets: Type.Array(Widget) });
export type UiSnapshot = Static<typeof UiSnapshot>;

// Item: toolCall and extensionMessage gain `view: Type.Optional(View)`.
// ClientRequests:
"ui/event": {
	params: Obj({
		threadId: Str,
		widgetKey: UiKey,
		id: Str,
		/** A field's new value; absent for a button. Unbounded here: a select option or text value may be long. */
		value: Type.Optional(Type.Union([Str, Bool])),
	}),
	result: Empty,
},
// "thread/start", "thread/resume", "thread/fork" results gain `ui: UiSnapshot`.
// ServerNotifications:
"ui/state": Obj({ threadId: Str, ...UiStateFields }),
/** A widget set or replaced; neither `lines` nor `view`: removed. */
"ui/widget": Type.Union([
	Obj({ threadId: Str, key: UiKey, placement: WidgetPlacement, lines: Type.Array(Str) }),
	Obj({ threadId: Str, key: UiKey, placement: WidgetPlacement, view: View }),
	Obj({ threadId: Str, key: UiKey }),
]),
```

`packages/app-server-protocol/src/index.ts` adds
`export * from "./view.ts";`.

`packages/cli/src/core/extensions/types.ts`:

```ts
import type { View } from "@knightcode/app-server-protocol";
export type { View };

/** A press of a button, or a change of a field, in a widget view. */
export interface ViewEvent {
	/** The key the widget was set with. */
	widgetKey: string;
	/** The button's or field's id. */
	id: string;
	/** A field's new value: a string for text and select, a boolean for toggle. Absent for a button. */
	value?: string | boolean;
}

// ExtensionUIContext gains:
	/** Set a widget drawn from a declarative view (docs/declarative-views.md). */
	setWidget(key: string, content: View | undefined, options?: ExtensionWidgetOptions): void;
	/**
	 * Receive presses and changes from widget views. Every handler gets every event of the thread: check `widgetKey`.
	 * Present only where widgets are interactive (the desktop app). Returns a function that removes the handler.
	 */
	onViewEvent?(handler: (event: ViewEvent) => void | Promise<void>): () => void;
```

`View` and `ViewEvent` are exported beside `ExtensionWidgetOptions` from
`core/extensions/index.ts`, `core/index.ts` and `src/index.ts`, so an
extension can write `import type { View } from "@knightcodeai/cli"`.

`packages/cli/src/app-server/dialogs.ts`:

```ts
export class ExtensionUiState {
	readonly statuses = new Map<string, string>();
	/**
	 * Insertion order is display order: every accepted setWidget moves its key last, as the terminal does. Each value
	 * is the server's own copy (`checkView`'s, or the lines' JSON copy): mutating the object an extension passed
	 * changes nothing here until it calls setWidget again.
	 */
	readonly widgets = new Map<string, Widget>();
	title: string | undefined;
	workingMessage: string | undefined;
	workingVisible = true;
	readonly handlers = new Set<(event: ViewEvent) => void | Promise<void>>();
	/** Terminal-only methods and refused keys already reported in this load. */
	readonly reported = new Set<string>();

	/** The `ui` of a start, resume or fork result; widgets ordered above, then below. */
	snapshot(): UiSnapshot;
	/** Forget everything and tell the subscribers (D16). */
	clear(thread: LoadedThread): void;
	/**
	 * Deliver a widget control's event to every handler, each in its own microtask; a failure becomes a `warning`.
	 * A widget or control that is gone (a stale click) delivers nothing. A value that does not fit the control
	 * throws AppServerError("invalidParams").
	 */
	dispatch(thread: LoadedThread, event: ViewEvent): void;
}

export function desktopDialogs(thread: LoadedThread): ExtensionUIContext & QuestionsUI; // existing; fills the stubs
```

`LoadedThread` gains `readonly ui = new ExtensionUiState();`.

`packages/cli/src/app-server/transcript.ts`:

```ts
/** `details.view` of a tool result or custom message when it is an acceptable view (D13). */
export function viewOf(details: unknown): View | undefined;
```

`packages/cli/src/app-server/history-pages.ts`: `pageHistory`'s input gains
`ui?: UiSnapshot`, measured with the thread: `JSON.stringify({ thread, ui,
...page })`.

`packages/cli/src/modes/interactive/components/view-component.ts` (new):

```ts
/** A declarative view drawn with TUI components (D14). Controls are drawn, never focused. */
export class ViewComponent extends Container {
	constructor(view: View);
}
```

Desktop renderer:

```ts
// store.ts
export interface ThreadView {
	// existing fields …
	ui: UiSnapshot;
}
export function sendViewEvent(threadId: string, widgetKey: string, id: string, value?: string | boolean): void;

// components/view.tsx
/** One view. Without `onEvent` its buttons and fields are drawn disabled (D5). */
export function ViewNode(props: { view: View; onEvent?: (id: string, value?: string | boolean) => void }): ReactNode;
/**
 * The widget panel above the composer; nothing without widgets. Props, not the store: `useStore` has no server
 * snapshot, so a store-bound component cannot be rendered by `renderToStaticMarkup` in the tests, and `view.tsx`
 * does not import `store.ts`, which registers window listeners when imported.
 */
export function WidgetPanel(props: {
	widgets: Widget[];
	onEvent: (widgetKey: string, id: string, value?: string | boolean) => void;
}): ReactNode;
```

## 5. Tasks

Implementation order; each task ends with its tests passing and
`bun run check-types` clean.

- [ ] Task 0: the protocol: `View`, `ui/*`, `ui` in results
- [ ] Task 1: the extension API and the terminal's `ViewComponent`
- [ ] Task 2: the server's extension UI state, `ui/state`, `ui/widget`, `ui`
- [ ] Task 3: `ui/event` and `onViewEvent`
- [ ] Task 4: views in tool results and extension messages
- [ ] Task 5: the desktop renderer
- [ ] Task 6: docs, example, system-prompt entry, changeset, validation

Global constraints:

- Harness boundary (§4.7): no edit to `packages/agent` or `packages/ai`. In
  `packages/cli/src/core` only type additions and exports in
  `core/extensions/types.ts`, `core/extensions/index.ts`, `core/index.ts`,
  and the one docs entry in `core/system-prompt.ts`. `runner.ts` and
  `agent-session.ts` do not change.
- No change to RPC mode (`packages/cli/src/modes/rpc/`, §12). A view passed to
  RPC's `setWidget` is not an array, so RPC ignores it as it ignores
  factories (`rpc-mode.ts:192-205`).
- The renderer imports only types from `@knightcode/app-server-protocol`, as
  today. The server validates every view; the renderer trusts its server.
- Desktop components use theme token classes only (desktop-shell.md §11.2), no
  colour literals; keys only through `DESKTOP_KEYBINDINGS`. The two the view
  needs exist: `desktop.item.activate` (Enter) and `desktop.picker.dismiss`
  (Escape).
- Prettier, tabs, 120 columns; no `any`; no inline imports;
  `erasableSyntaxOnly`. Windows and POSIX.
- Server tests use `test/app-server/harness.ts` (`startServer`,
  `extraExtensions`, `connect("desktop")`) and the faux provider; race tests
  wait on gates or notifications, never fixed sleeps.
- Each new protocol message gets a valid example in `protocol.test.ts`, and
  `packages/cli/docs/app-server.schema.json` is regenerated
  (`cd packages/app-server-protocol && bun run generate:schema`).
- Before running checks in a fresh worktree: `bun install`, then
  `bun run hydrate:model-data`, which rewrites the committed
  `packages/ai/src/providers/data/agentrouter.json`; restore it with
  `git restore packages/ai/src/providers/data/agentrouter.json` before any
  commit.

### Task 0: the protocol

**Files:** create `packages/app-server-protocol/src/view.ts`; modify
`src/protocol.ts`, `src/index.ts`, `test/protocol.test.ts`; regenerate
`packages/cli/docs/app-server.schema.json`.

**Steps:**

1. Write the failing tests in `protocol.test.ts`:
   - one valid example each for `ui/state`, all three `ui/widget` shapes,
     `ui/event` (with and without `value`), and the `ui` field of the start,
     resume and fork results; a `toolCall` and an `extensionMessage` item with
     a `view`;
   - rejections: `ui/event` without `widgetKey`; `ui/widget` with both
     `lines` and `view`; a view with an `html` member; a node of type
     `script`; a `button` without `id`;
   - `checkView` returns `{view}` for a view using every node type, nested
     three deep, with `view` equal to the input but not the same object; and
     `{error}` for each step of section 4: a list that contains itself and a
     list 200,000 levels deep (neither throws); a 70 KiB markdown at the
     default budget and a 17 KiB one at `WIDGET_MAX_BYTES`; nine levels of
     stacks; two fields with id `a`; a table row of 2 cells for 3 columns; a
     toggle with value `"on"`; a select whose value is not in `options`; a
     select without `options`; a text field with `options`; a valid text view
     whose prototype has a `toJSON` returning `{type: "stack", children:
     null}` (the copy is checked, so it is refused); `undefined` and a
     function (no JSON text, refused without throwing).
2. Run `cd packages/app-server-protocol && bun x vitest --run`: FAIL.
3. Write `view.ts` as section 4 gives it; export it from `index.ts`; add the
   protocol pieces. Probed 2026-10-22 against TypeBox 1.3.27: a
   `Type.Cyclic` view nested in an object compiles with `Compile`, rejects
   unknown members and node types at every depth, `Static` gives a recursive
   discriminated union that `tsc --strict` checks (an unknown member and a
   wrong nested type are errors), and a 2,000-deep value checks without a
   stack overflow.
4. `bun run generate:schema` first, then the tests pass:
   `protocol.test.ts:485-488` compares the committed
   `packages/cli/docs/app-server.schema.json` with `schemaDocument()`, so
   that test is the freshness check.
5. `bun run check-types`: the start, resume and fork handlers now miss `ui`.
   Add `ui: EMPTY_UI` there as a placeholder (Task 2 replaces it), and in the
   desktop's `startThread` and resume install, `ui` from the result
   (`cd apps/desktop && bun run check-types`).

### Task 1: the extension API and the terminal

**Files:** modify `packages/cli/src/core/extensions/types.ts`,
`core/extensions/index.ts`, `core/index.ts`, `src/index.ts`; create
`packages/cli/src/modes/interactive/components/view-component.ts`; modify
`interactive-mode.ts` (`setExtensionWidget`), `components/tool-execution.ts`
(`createResultFallback`), `components/custom-message.ts` (`rebuild`); test
`packages/cli/test/view-component.test.ts` (new).

**Steps:**

1. Add the types of section 4. `setExtensionWidget`'s `content` gains
   `| View`.
2. `ViewComponent` builds one child per node:
   - `text`: `Text` with the tone's theme colour (`muted` → `"muted"`,
     `accent` → `"accent"`, `success` → `"success"`, `warning` →
     `"warning"`, `error` → `"error"`; none → plain).
   - `markdown`: `Markdown(markdown, 0, 0, getMarkdownTheme())`.
   - `stack`: `VStack` of the children; `horizontal` → `HStack` with
     `{ gap: 2 }`.
   - `list`: a `VStack` of `Gutter(child, "• ", "  ")`.
   - `table`: `Markdown` of a pipe table built from `columns` and `rows`,
     each cell's `|` escaped as `\|` and its line breaks replaced by spaces,
     so the terminal's markdown table layout draws it.
   - `progress`: one `Text` line: a 20-cell bar (`█` filled in `"accent"`,
     `░` in `"muted"`), then the label and the percentage
     (`Math.min(100, Math.round(value / max * 100))`).
   - `button`: `Text` of `[ label ]` in `"accent"`.
   - `field`: `Text` of `label: value` (text), `[x] label` or `[ ] label`
     (toggle), `label: value ▾` (select).
3. `setExtensionWidget`: arrays as today; a function is a factory as today
   (`typeof content === "function"`, checked before the view branch now that
   the union holds an object too). A view: `checkView(content,
   WIDGET_MAX_BYTES)` gives `{view}` → a `ViewComponent` of that copy,
   indented one column as line widgets are (`Gutter(component, " ", " ")`);
   `{error}` → one `Text` line in `"warning"`: `(invalid view: <error>)`, so
   the extension author sees it.
4. `ToolExecutionComponent.createResultFallback`: when
   `checkView(this.result?.details?.view)` (`result` is optional on the
   class, `tool-execution.ts:63`) gives `{view}`, return a
   `ViewComponent` of it instead of the text output; the image blocks below
   are unchanged. A tool's own `renderResult` still wins (D14).
5. `CustomMessageComponent.rebuild`: in the default block (no custom
   renderer, or one that returned nothing),
   `checkView((this.message.details as { view?: unknown } | undefined)?.view)`
   giving `{view}` → the `callBlock` body is a `ViewComponent` instead of the
   `Markdown`. The message is `CustomMessage<unknown>`
   (`custom-message.ts:15`), so `details` needs that narrowing to compile; it
   is safe at runtime, since `?.` covers `null` and a primitive has no
   `view`.
6. Tests (`view-component.test.ts`, a `TuiMainScreen` over `VirtualTerminal`
   as `output-pad.test.ts` does, `initTheme()` first):
   - every node type renders its text (ANSI stripped for the comparison); no
     line is wider than the width at 20, 40 and 80 columns
     (`visibleWidth`), including a horizontal stack of three tables;
   - `InteractiveMode.prototype.setExtensionWidget.call(fake, "k", view)` (as
     `interactive-mode-status.test.ts` calls prototype methods) puts a
     `ViewComponent` in the above map, `{placement: "belowEditor"}` in the
     below map; an invalid view gives the one warning line;
   - a `ToolExecutionComponent` with no definition and a result whose
     `details.view` is a table draws the table, not the text output; with a
     definition that has `renderResult`, that renderer's output shows;
   - a `CustomMessageComponent` without a renderer and with `details.view`
     draws the view under its `● customType` header.

### Task 2: the server's extension UI state

**Files:** modify `packages/cli/src/app-server/dialogs.ts`,
`loaded-thread.ts`, `threads.ts` (`start`, `resume`, `fork`, `bind`'s
`reload`, the `TERMINAL_ONLY_COMMANDS` comment), `history-pages.ts`; test
`packages/cli/test/app-server/extension-ui.test.ts` (new).

**Steps:**

1. `ExtensionUiState` as section 4 gives it; `LoadedThread.ui`.
2. In `desktopDialogs`:
   - `clean(text)`: `stripAnsi`, `[\r\n\t]` and runs of spaces folded to one
     space, trimmed, then cut to 200 code points with `…` (the loop of
     `titleOf`, `loaded-thread.ts:26-38`, which it calls as
     `titleOf(folded, "")`).
   - Keys: a status or widget key that is empty or longer than 128
     characters is refused; its warning and `reported` entry name the key cut
     to 128 characters.
   - `setStatus(key, text)`: `text` undefined, or empty once cleaned, deletes
     the key; otherwise sets it. A 51st key is refused (D11). A call that
     changes nothing sends nothing; any other sends one
     `ui/state` with the whole state (`statuses` sorted by key with
     `localeCompare`, as `footer.ts:221-223`).
   - `setTitle(title)`, `setWorkingMessage(message?)`,
     `setWorkingVisible(visible)`: the same pattern. An empty title, and
     `setWorkingMessage()` with no argument, clear the field.
   - `setHiddenThinkingLabel`: nothing (D8).
   - `setWidget(key, content, options)`: the placement is
     `options?.placement ?? "aboveEditor"`, as in the terminal.
     `undefined` removes the key and sends
     `ui/widget {threadId, key}` when it existed. An array: copied through
     JSON as `checkView` copies (a stringify failure is a refusal), refused
     unless every entry of the copy is a string and its JSON is at most
     `WIDGET_MAX_BYTES`, then each line cleaned with `stripAnsi` only (no
     cut, no folding: a widget line keeps its spacing). A function:
     terminal-only (step 3). Any other value: `checkView(content,
     WIDGET_MAX_BYTES)`, refused on `{error}`. A new key past 16 widgets is
     refused. Every accepted call deletes the key and sets it again with the
     copy (moving it last, as the terminal's `setExtensionWidget` does,
     `interactive-mode.ts:2429-2455`) and sends `ui/widget` from that copy;
     there is no "unchanged" shortcut for widgets, since even an identical
     call reorders them.
   - A refusal is reported once per key per load (`reported` holds
     `widget:<key>` or `status:<key>`) with a message such as `Widget "tests"
     was not shown: a table row has 2 cells for 3 columns`, written to stderr
     and delivered as extension errors are (`threads.ts:2049-2053`): a
     `warning {source: "extension", threadId, message}` to the subscribers,
     or, while the thread has none (an extension's `session_start` during the
     load), a `{source: "extension", message}` pushed to
     `thread.loadWarnings`, which the opening result returns.
3. Terminal-only reports (D6): `setWidget` with a function, `custom`,
   `onTerminalInput` with a handler, `setWorkingIndicator` with options,
   `setHeader` and `setFooter` with a factory. Each writes
   `app-server: thread <id>: <method>("<key>") draws only in the terminal; the
   desktop app ignores it` (the key only for `setWidget`) to stderr, once per
   method per load (`reported` holds the method name). Return values are
   unchanged: `custom` resolves `undefined`, `onTerminalInput` returns a no-op.
4. `ExtensionUiState.snapshot()`: statuses sorted by key, `title` and
   `workingMessage` when set, `workingVisible`, widgets with `aboveEditor`
   ones first, each group in map order. `clear(thread)`: when anything was
   set, one `ui/state` with the empty state and one `ui/widget {threadId,
   key}` per widget; then empty the maps, `handlers` and `reported`.
5. `ThreadManager`:
   - `start` and `fork` return through `commitOnSend`, with
     `ui: thread.ui.snapshot()` read in the commit, so a change an extension
     makes between the handler's return and the send is in the snapshot or
     arrives after the response, never between (D2).
   - `resume`'s commit reads `ui` first, passes it to `this.history(…)`, and
     returns it. `pageHistory` measures `{ thread, ui, ...page }`.
   - `bind`'s `reload` becomes (D16):

     ```ts
     reload: async () => {
     	// The old runner is invalidated early in reload (agent-session.ts:3898) and settings and resources load
     	// after it, so a press in between must not reach its handlers: they are dropped at once.
     	thread.ui.handlers.clear();
     	try {
     		await session.reload({ beforeSessionStart: () => thread.ui.clear(thread) });
     	} catch (error) {
     		// A failed reload never reaches beforeSessionStart; the old extensions are gone, so is their UI.
     		thread.ui.clear(thread);
     		throw error;
     	}
     },
     ```
   - The `TERMINAL_ONLY_COMMANDS` comment says the three commands open
     `custom()` components, which the desktop does not draw (D6).
6. Tests (`extension-ui.test.ts`; a desktop connection unless stated; an
   inline extension whose `session_start` or command does the UI calls, and
   the `probeServer` pattern of `dialogs.test.ts` for calls during a turn):
   - each of `setStatus`, `setTitle`, `setWorkingMessage` and
     `setWorkingVisible` sends one `ui/state` carrying the whole state;
     clearing a status removes it; `"\u001b[32m✓\u001b[0m 42\npassed"`
     arrives as `"✓ 42 passed"`; a 300-character title arrives as 200 code
     points ending in `…`; repeating a call sends nothing;
   - `setWidget` with lines and with a view reaches the subscriber as
     `ui/widget` with `placement`; `undefined` removes it; setting the first
     of two keys again, with identical content, sends a `ui/widget` and moves
     it after the second in the next snapshot;
   - an invalid view, a 17 KiB view, a lines array holding a number, a 17th
     widget, a 51st status and a 129-character key each send nothing on
     `ui/*` and one `warning` naming the key, also when repeated three times;
   - an invalid widget set in `session_start` is in `thread/start`'s
     `warnings`;
   - an extension that changes a toggle's `value` in the view object it
     already passed, then calls `setWidget` with it again, sends a
     `ui/widget` with the new value; mutating it after that call changes
     neither the next `thread/resume`'s `ui` nor anything sent;
   - a widget factory, `custom`, `onTerminalInput`, `setWorkingIndicator`,
     `setHeader` and `setFooter` send nothing; each method writes one stderr
     line however often it is called (spy on `console.error`), and `custom`
     resolves `undefined`;
   - a status and a widget set in `session_start` are in `thread/start`'s
     `ui`; a second connection's `thread/resume` returns the current `ui`;
     a fork's `ui` holds what the fork's own extensions set while loading;
   - `/reload` through an extension command calling `ctx.reload()`: the
     subscriber gets the empty `ui/state` and a removal per widget, then the
     state the reloaded extension sets in `session_start`; a title the
     outgoing extension sets in its `session_shutdown` is gone afterwards; a
     `ui/event` sent while the reload is held in the new extension's
     factory (a gate) answers `{}` and reaches no handler; a reload whose
     resource load rejects (`vi.spyOn` on
     `server.threads.get(id).session.resourceLoader.reload`, the harness
     returns `threads`) still clears the state and sends the clears;
   - a thread a `tui` connection loads has an empty `ui` (no UI context is
     bound there, `threads.ts:2048`);
   - `pageHistory` (unit, the fixture of "a byte-limited page takes as many
     inline turns as fit", `history-pages.test.ts:88-98`: 30 turns of 60,000
     characters, which stay inline; a turn over 64 KiB would become a small
     reference and fill nothing) with a 300 KiB `ui` returns fewer turns than
     without it, and the serialized `{thread, ui, ...page}` plus the envelope
     reserve stays within 1 MiB.

### Task 3: `ui/event` and `onViewEvent`

**Files:** modify `dialogs.ts` (`onViewEvent`, `ExtensionUiState.dispatch`),
`threads.ts` (`handlers()`); extend `test/app-server/extension-ui.test.ts`.

**Steps:**

1. `onViewEvent(handler)` adds to `thread.ui.handlers` and returns the
   delete. The runner's `{...ui}` wrapping (`runner.ts:582-590`) copies it, as
   it copies `askQuestions`.
2. `dispatch(thread, event)`: find the widget by `widgetKey`; it must hold a
   view, and the view a `button` or `field` with `event.id` (a depth-first
   walk). None → return (a stale click). A `button` with a `value`, a
   `toggle` with a non-boolean, a `text` with a non-string, a `select` whose
   value is not in its `options` → `AppServerError("invalidParams", …)`.
   Then, for each handler in a snapshot of the set:
   `Promise.resolve().then(() => handler(event)).catch(report)`, where
   `report` sends `warning {source: "extension", threadId, message: "A view
   event handler failed: <message>"}` and writes it to stderr.
3. `handlers()`: `"ui/event": async ({ threadId, ...event }) => { const
   thread = this.get(threadId); thread.ui.dispatch(thread, event); return {};
   }`. `get` answers `threadNotFound` for a thread that is not loaded
   (`threads.ts:274-278`); an unloaded thread has no widgets to press.
4. Tests:
   - two extensions each register a handler; a press of a button in widget
     `a` reaches both with `{widgetKey: "a", id, value: undefined}`, and the
     request answers `{}`;
   - a toggle answered with `true` delivers `true`; with `"on"` answers
     `invalidParams` and delivers nothing; a select value outside its
     options answers `invalidParams`; a button with a value answers
     `invalidParams`;
   - an id the widget's view lacks, a key never set, and a key holding lines
     answer `{}` and deliver nothing;
   - a handler that throws and one that rejects each produce one `warning`;
     the other handler still receives the event;
   - after `ctx.reload()` the old handlers receive nothing;
   - `ui/event` for a thread that is not loaded answers `threadNotFound`;
   - over stdio (`stdio.test.ts`'s `spawnServer`), a `ui/event` request is
     answered (the method is reachable through the real transport).

### Task 4: views in tool results and extension messages

**Files:** modify `transcript.ts` (`viewOf`, `readTurns`), `item-mapper.ts`
(tool results, custom messages); extend `test/app-server/extension-ui.test.ts`.

**Steps:**

1. `viewOf(details)`: `checkView` of the `view` member of an object
   `details`; its copy on `{view}`, else undefined. A live item therefore
   holds a copy the running-turn snapshot can always serialize
   (`item-mapper.ts:157-165` serializes retained items on every resume).
   Read-back takes the view from the session's entries, which keep the
   result objects the tool returned (`session-manager.ts:1301-1309`): a
   tool that mutates its result after returning it changes what later reads
   see, as it already does for the result's text and file changes. That is
   the harness's behaviour for every field, not a view rule (section 8).
2. `readTurns`: a tool result sets `call.view` from `viewOf(message.details)`;
   a `custom_message` entry's item gets `view` from `viewOf(entry.details)`.
3. `ItemMapper`: the tool result branch (`item-mapper.ts:337-347`) and the
   custom message branch (`:287-305`) set `view` the same way from the
   message's `details`, before the item is sent. A nested call (code mode,
   `ctx.executeTool`) completes in the `tool_execution_end` branch instead
   (`:384-394`, its result never reaches the top-level branch, `:340`), so
   that branch sets `item.view` from `viewOf(event.result.details)` too. A
   nested call stays live only (§4.2).
4. Tests:
   - a tool whose result has `details.view` (a table) gives a `toolCall`
     item whose `view` is equal in `item/completed` and in `thread/read`
     after the turn, and after an unload and resume;
   - an extension message sent with `knightcode.sendMessage({customType,
     content, display: true, details: {view}})` gives an `extensionMessage`
     with the same `view` live and read back;
   - an invalid `details.view` gives no `view` and the text output unchanged,
     live and read back, with no `warning`;
   - a tool that runs another tool through `ctx.executeTool`, whose result
     has a `details.view`, gives a nested item (`parentItemId` set) whose
     `item/completed` carries that view;
   - a tool whose 60 KiB view plus output passes 64 KiB arrives as an
     `itemReference` whose payload holds the view (§5.9's path, unchanged).

### Task 5: the desktop renderer

**Files:** modify `apps/desktop/src/renderer/store.ts`,
`components/thread-view.tsx`, `components/items.tsx`,
`components/activity.tsx`, `renderer/activity.ts`; create
`components/view.tsx`; tests `apps/desktop/test/renderer/store.test.ts`
(extended), `apps/desktop/test/renderer/view.test.ts` (new).

**Steps:**

1. Store:
   - `ThreadView.ui` from the result in `resumeThread` and `startThread`.
   - `ui/state`: replace `statuses`, `title`, `workingMessage` and
     `workingVisible` (an absent `title` or `workingMessage` clears it).
   - `ui/widget`: remove the key; with `lines` or `view`, append it. That is
     the server's order (the last set comes last), and `WidgetPanel` groups
     by placement.
   - Both have `threadId`, so `enqueue` buffers them while a resume installs
     its snapshot (`store.ts:558-573`) and replays them after, as it does for
     `turn/queue/updated`.
   - `sendViewEvent(threadId, widgetKey, id, value?)`:
     `client.request("ui/event", …)`; an error toasts its message.
2. `components/view.tsx`, `ViewNode`:
   - `text`: a `div` with `whitespace-pre-wrap text-base` and the tone's
     class: `muted` → `text-tertiary`, `accent` → `text-accent`, `success` →
     `text-success`, `warning` → `text-warning`, `error` → `text-danger-text`.
   - `markdown`: the transcript's `Markdown` (no HTML, no images; links open
     outside the app on click, `markdown.tsx:17-19`).
   - `stack`: `flex flex-col gap-2`, or `flex flex-wrap items-center gap-3`
     when horizontal. `list`: `ul` with `list-disc ps-5`.
   - `table`: a plain `table` inside `kc-markdown kc-md-table`, so it looks
     like a markdown table.
   - `progress`: `role="progressbar"` with `aria-valuenow` and
     `aria-valuemax`, a track (`bg-surface-secondary`) and a fill
     (`bg-accent`, its width a percentage style), then the label.
   - `button`: `Button` (`variant="soft" size="sm"`), disabled without
     `onEvent`.
   - `field`: a `label` around it. Text: an `input.kc-input` holding a draft
     while focused, sending `onEvent(id, draft)` on
     `desktop.item.activate` and on blur when the draft changed, and putting
     the value back on `desktop.picker.dismiss` (both through `matches`, as
     `thread-view.tsx:289-293`). Toggle: `Switch`. Select: a `Menu` listing
     `options` with a check on the current one. Fields show the view's
     value; the extension answers a change by setting the widget again.
   - `WidgetPanel({widgets, onEvent})`: `null` without widgets. Otherwise, in
     the composer's column (`mx-auto w-full max-w-3xl px-4`), one card
     (`rounded-lg bg-card-soft`, with the hairline ring `EditedFilesCard`
     uses), at most
     `max-h-48` with `overflow-y-auto`. `aboveEditor` widgets come first, then
     `belowEditor`. Lines are monospace (`font-code text-code text-secondary
     whitespace-pre-wrap`), the first 10 then `… (widget truncated)`, as the
     terminal's `MAX_WIDGET_LINES` (`interactive-mode.ts:2501`). A view gets
     `onEvent` bound to the panel's `onEvent` with its key.
3. `thread-view.tsx`:
   - status chips in the header, after the title's spacer and before the
     actions: one `span` per status (`rounded-md border border-line px-2
     text-sm text-secondary truncate max-w-[200px]`), in a `Tooltip` with the
     full text;
   - the window title: an effect sets `document.title` to `ui.title` while it
     is set, and back to `"KnightCode"` when it clears or the view unmounts;
   - `<WidgetPanel widgets={view.ui.widgets} onEvent={(key, control, value)
     => sendViewEvent(id, key, control, value)} />` (when the view is held)
     just above the request/composer block
     (`thread-view.tsx:433-446`), so a widget stays visible while an approval
     card has the composer's place.
4. `items.tsx`: the waiting row (`items.tsx:525-528`) reads the held thread's
   `ui`. `workingVisible === false` hides it; `workingMessage` replaces
   "Thinking". `WorkItems`' `extensionMessage` renders `ViewNode` (no
   `onEvent`) in place of `Markdown` when the item has a `view`.
5. A tool's view wins over the desktop's name-based cards: an extension may
   override a built-in such as `bash` (`agent-session.ts:3789-3791`), and
   `activity.ts:18-20` classifies by name alone. `activity.ts` gains
   `toolBody(item): "view" | "command" | "edit" | "question" | "plan" |
   "output"`, returning `"view"` first whenever `item.view` is set, then the
   choices `ToolBody` makes today (`activity.tsx:368-382`); `ToolBody`
   switches on it and renders `ViewNode` (no `onEvent`) for `"view"`.
   `expandable` is also true when `item.view` is set.
6. Tests:
   - `activity.test.ts`: `toolBody` gives `"view"` for a `bash` item with a
     view and `"command"` for one without; `"view"` for an extension tool
     with a view, `"output"` without; `expandable` is true for a read-only
     tool with a view;
   - store (the fake client keeps the `onNotification` handler so the test
     can feed notifications): a resume result's `ui` installs; `ui/state`
     replaces the state and an absent `title` clears it; `ui/widget` sets,
     replaces (moving the key last) and removes; a `ui/widget` arriving while
     the resume is pending applies after the snapshot, not before it;
     `startThread` installs its result's `ui`; after `thread/replaced` the new
     thread's resumed `ui` replaces the old one;
   - `view.test.ts`, rendering with `renderToStaticMarkup` from
     `react-dom/server` and `createElement` (a `.ts` file: the desktop
     `tsconfig.json` includes `test/**/*.ts` only), `client.ts` mocked as
     `store.test.ts` does: each tone gives its class; markdown containing
     `<script>alert(1)</script>` and `![x](https://example.com/x.png)` renders
     no `<script>` and no `<img>`; a button and every field kind render
     `disabled` without `onEvent` and enabled with it; a progress of 150/100
     renders `aria-valuenow="150"` and a 100% fill; a table renders its
     header and cells; a `WidgetPanel` given a 12-line widget renders 10
     lines and `… (widget truncated)`, and an `aboveEditor` widget before a
     `belowEditor` one set earlier. Neither `ViewNode` nor `WidgetPanel`
     reads the store, so nothing in these renders calls `useStore`.

### Task 6: docs, example, system-prompt entry, changeset

**Files:** create `packages/cli/docs/declarative-views.md`,
`packages/cli/examples/extensions/desktop-view.ts`,
`.changeset/<branch>.md`; modify `packages/cli/docs/desktop.md`,
`app-server.md`, `extensions.md`, `docs.json`,
`examples/extensions/README.md`, `packages/cli/src/core/system-prompt.ts`,
`packages/cli/test/system-prompt.test.ts`; test
`packages/cli/test/app-server/extension-ui.test.ts` (the example).

**Steps:**

1. `declarative-views.md`: what a view is (data, never HTML, scripts or
   loadable URLs); a table of the node types with an example each; the
   validation rules and limits of section 4 and D11; `setWidget(key, view,
   {placement})`; `details.view` on a tool result and on
   `sendMessage({…, details: {view}})`; `ctx.ui.onViewEvent?.(handler)` and
   `ViewEvent`; keys are shared by every extension of a thread, so prefix
   them; where each part draws (terminal: everything, controls as text;
   desktop: everything, controls live in widgets only; RPC, JSON and print:
   views are not drawn); a link to the example. Added to `docs.json` under
   "Build on KnightCode" after "Build Extensions" (the documentation test
   fails on an orphaned page).
2. `desktop.md`: a section "Extensions" that says what an extension shows in
   the app (dialogs, notices, status chips, the window title, the working
   text, the widget panel, views in tool rows and messages), what it does not
   (widget factories, custom components, header and footer, raw input,
   editor access), that those are reported once in `app-server.log`, and links
   `declarative-views.md` and `app-server.md`. This page is the index the
   system prompt names (§8.3).
3. `app-server.md`: "Dialogs" becomes "Dialogs and extension UI" and replaces
   "Widgets, status, header, footer and custom components draw only in the
   terminal and do nothing here" with `ui/state`, `ui/widget`, the `ui` of
   the start, resume and fork results (install it, then apply the
   notifications, buffered across a resume as `queue` is), `ui/event`, and
   what stays terminal-only. A method reference entry for `ui/event` with its
   errors (`threadNotFound`, `invalidParams`) and a JSON example. The limits
   list gains the widget, status and view limits.
4. `extensions.md:389-391`: the stale "Desktop mode currently has no extension
   UI (`hasUI` is false)" becomes what desktop mode draws, with links to
   `desktop.md` and `declarative-views.md`.
5. `examples/extensions/desktop-view.ts`: in `session_start` (when
   `ctx.hasUI`), a widget `desktop-view:checks` with a text, a toggle
   `verbose` and a button `reset`, and an `onViewEvent?.` handler that updates
   the factory-closure state (§5.3) and sets the widget again; a tool
   `check_summary` whose result carries a table view. A README row under
   "Custom Tools". A server test loads the example through `extraExtensions`
   (importing its default export, which also type-checks it) and asserts the
   widget arrives in `thread/start`'s `ui`, a press of `reset` changes it, and
   the tool's item carries the table view.
6. `system-prompt.ts:167`: append
   `, desktop app and its extensions (docs/desktop.md)` to the
   "When asked about:" list (50 characters, about 13 tokens by the repo's
   characters / 4 estimate, within §11's 15). `system-prompt.test.ts` pins the
   cost: the built prompt's "- When asked about:" line is exactly 606
   characters long (556 today).
7. Changeset: `bun run changeset added minor`, finishing the sentence:
   "Added declarative views for extensions: `ctx.ui.setWidget(key, view)` and
   `details.view` on tool results and extension messages, drawn in the
   terminal and by app server clients, which also receive extension status,
   titles, working messages and widgets, and send widget button and field
   events back through `ctx.ui.onViewEvent`."
8. Run section 9 in full.

## 6. File manifest

| File | Change |
| --- | --- |
| `packages/app-server-protocol/src/view.ts` | new: `View`, limits, `checkView` |
| `packages/app-server-protocol/src/protocol.ts` | `ui/state`, `ui/widget`, `ui/event`, `Widget`, `UiSnapshot`, `ui` on start/resume/fork results, `view` on two item types |
| `packages/app-server-protocol/src/index.ts` | export `view.ts` |
| `packages/app-server-protocol/test/protocol.test.ts` | examples, rejections, `checkView` steps |
| `packages/cli/docs/app-server.schema.json` | regenerated |
| `packages/cli/src/core/extensions/types.ts` | `View` overload, `ViewEvent`, `onViewEvent?` |
| `packages/cli/src/core/extensions/index.ts`, `core/index.ts`, `src/index.ts` | type exports |
| `packages/cli/src/core/system-prompt.ts` | one docs entry |
| `packages/cli/src/app-server/dialogs.ts` | `ExtensionUiState`; the stubs filled; terminal-only reports; `onViewEvent` |
| `packages/cli/src/app-server/loaded-thread.ts` | `ui` field |
| `packages/cli/src/app-server/threads.ts` | `ui` in results (commits), `ui/event`, reload clear, comment |
| `packages/cli/src/app-server/history-pages.ts` | `ui` in the page budget |
| `packages/cli/src/app-server/transcript.ts` | `viewOf`; views read back |
| `packages/cli/src/app-server/item-mapper.ts` | views live |
| `packages/cli/src/modes/interactive/components/view-component.ts` | new |
| `packages/cli/src/modes/interactive/interactive-mode.ts` | `setExtensionWidget` view branch |
| `packages/cli/src/modes/interactive/components/tool-execution.ts` | view fallback |
| `packages/cli/src/modes/interactive/components/custom-message.ts` | view in the default block |
| `packages/cli/test/view-component.test.ts` | new |
| `packages/cli/test/app-server/extension-ui.test.ts` | new |
| `packages/cli/test/app-server/history-pages.test.ts` | the `ui` budget case |
| `packages/cli/test/system-prompt.test.ts` | the pinned line length |
| `packages/cli/docs/declarative-views.md` | new |
| `packages/cli/docs/desktop.md`, `app-server.md`, `extensions.md`, `docs.json` | as Task 6 |
| `packages/cli/examples/extensions/desktop-view.ts`, `README.md` | new example, README row |
| `apps/desktop/src/renderer/store.ts` | `ui` slice, `sendViewEvent` |
| `apps/desktop/src/renderer/components/view.tsx` | new: `ViewNode`, `WidgetPanel` |
| `apps/desktop/src/renderer/components/thread-view.tsx` | chips, window title, widget panel |
| `apps/desktop/src/renderer/components/items.tsx` | waiting row, extension message views |
| `apps/desktop/src/renderer/components/activity.tsx`, `renderer/activity.ts` | tool row views |
| `apps/desktop/test/renderer/store.test.ts`, `activity.test.ts`, `view.test.ts` | extended, extended, new |
| `.changeset/<branch>.md` | `Added`, `@knightcodeai/cli` minor |

## 7. Required tests

Protocol:

- Every new message, the `ui` result field and both item `view`s have a valid
  example; each rejects a missing required field and an unknown member; the
  generated schema is up to date.
- `checkView` accepts every node type nested and returns a copy, not the
  input; it refuses each step of section 4 with its own message, including a
  cyclic and a 200,000-deep list without throwing, and a value whose
  `toJSON` yields an invalid view.

Server (faux provider, in-process unless stated):

- Status, title, working message and working visibility reach a desktop
  subscriber as whole-state `ui/state`; a call that changes nothing sends
  nothing; text is cleaned of ANSI escapes and line breaks and cut to 200 code
  points.
- Widgets with lines and with a view reach the subscriber as `ui/widget` with
  their placement; removal and re-setting, identical content included,
  follow the terminal's order.
- A refused widget or status (including a key over 128 characters) sends
  nothing on `ui/*` and one warning per key per load: a `warning`
  notification, or a load warning in the opening result when it happened
  while the thread loaded. Terminal-only methods send nothing and log once per
  method per load.
- The server keeps its own copy of every accepted widget: mutating the object
  an extension passed changes nothing it stores or sends, until the next
  `setWidget`.
- `thread/start`, `thread/resume` and `thread/fork` return the thread's
  current `ui`, read at send; a second connection resuming a thread gets it.
- A resume page counts `ui` within its 1 MiB budget.
- A reload drops the view handlers when it begins, clears the state after the
  outgoing extensions' `session_shutdown` and before the new `session_start`
  (or when the reload fails), and tells the subscribers.
- `ui/event` reaches every handler with its widget key; a value that does not
  fit answers `invalidParams`; a stale press answers `{}` and delivers
  nothing; a failing handler produces a `warning` and does not stop the
  others; an unloaded thread answers `threadNotFound`; the request works over
  stdio.
- A tool result's and an extension message's `details.view` is the item's
  `view`, equal live, read back, and after unload and resume; a nested call's
  result view is on its live item; an invalid view is absent without a
  warning; an oversized item still travels as a reference.
- A thread a terminal-mode connection loads has an empty `ui`.

Terminal:

- `ViewComponent` draws every node type within the width at 20, 40 and 80
  columns.
- A view widget draws at its placement; an invalid one draws one warning
  line.
- A tool result's view replaces the raw-output fallback, and `renderResult`
  wins over it; a custom message's view replaces its markdown.

Desktop renderer:

- The store installs `ui` from resume and start results, applies `ui/state`
  and `ui/widget`, and applies those that arrive during a resume after its
  snapshot.
- A view renders no `<script>`, no `<img>` and no raw HTML; tones map to token
  classes; controls are disabled without `onEvent`; a widget shows at most 10
  lines.
- A tool row with a view shows the view, also for a tool named `bash` that an
  extension overrides.
- The existing keybinding scan (no `e.key ===` outside the dispatcher) and
  theme tests still pass.

Docs:

- The system prompt's "When asked about:" line is exactly 606 characters.
- The documentation test passes with `declarative-views.md` in the
  navigation.
- The example loads in a desktop thread; its widget, its button and its tool
  view work end to end.

## 8. Exclusions

Do not add:

- HTML, scripts, images or URLs that load in `View` (§12), or a view node
  that is not in section 4.
- A per-extension UI context, or an extension name on any `ui/*` message
  (D1).
- Any change to `runner.ts`, `agent-session.ts`, `packages/agent`,
  `packages/ai`, or RPC mode (`packages/cli/src/modes/rpc/`).
- Live controls in tool rows, extension messages or the terminal (D5).
- Desktop rendering of widget factories, `custom()`, header, footer,
  terminal input or the working indicator; `ui/local` and local handles are
  Phase D (§7.3).
- A hidden-thinking label on the desktop (D8).
- An ANSI renderer in the desktop (D12).
- Editor access on the desktop (`setEditorText`, `pasteToEditor`,
  `getEditorText`, `setEditorComponent`, `addAutocompleteProvider`): they stay
  silent no-ops.
- Desktop versions of `/usage`, `/llama` or `/undo` (they open `custom()`).
- GUI extensions, `docs/desktop-extensions.md` and the desktop SDK (desktop
  shell S3).
- Copies of tool results or custom messages in the harness, or a second
  record of a view beside its entry. A tool that mutates its result after
  returning it changes what later reads of the loaded thread see, for every
  field of the result, views included; that is the harness's behaviour
  (§4.7), unchanged here.
- A fix for overlapping resumes of one thread in the desktop store. Two
  resumes in flight (opening a thread twice, a reconnect,
  `store.ts:611, 675-678`) both install, and the one whose history payloads
  resolve last wins even when its snapshot is older (`store.ts:696-720`).
  Turns and the queue already have this race; `ui` rides the same path and
  neither fixes nor worsens it. A fix has to keep server requests buffered
  across a superseded resume and order one resume's replay against another's
  install, so it is its own change.
- The load-warning banner of desktop-shell.md §8. The desktop shows load
  warnings and `warning` notifications as toasts today (`store.ts:524-526,
  719, 749-750`); Phase C's refusals take the same path and get the banner
  when the shell builds it.
- System-prompt text beyond the one docs entry; no tool description changes.
- A changeset for the desktop app.

## 9. Validation

From the repository root (in a fresh worktree run `bun install` and
`bun run hydrate:model-data` first, and `git restore
packages/ai/src/providers/data/agentrouter.json` before committing):

```bash
bun run check-types
cd packages/app-server-protocol && bun x vitest --run && cd ../..
cd packages/cli && bun x vitest --run test/app-server/ test/view-component.test.ts test/system-prompt.test.ts test/documentation.test.ts test/custom-message.test.ts test/output-pad.test.ts && cd ../..
cd apps/desktop && bun run check-types && bun x vitest --run && cd ../..
bun x prettier --check "packages/app-server-protocol/**/*.ts" "packages/cli/src/app-server/**/*.ts" "packages/cli/test/app-server/**/*.ts" packages/cli/src/modes/interactive/components/view-component.ts packages/cli/test/view-component.test.ts
bun run scripts/changelog-sections.ts
```

The schema is fresh when the protocol test "the generated JSON Schema is up
to date" passes (run `bun run generate:schema` first).

Greps (`rg`), with the expected result:

```bash
rg -n "from \"@knightcode/(ai|agent)\"" packages/app-server-protocol/src             # no matches
rg -n "setStatus: \(\) => \{\}|setWidget: \(\) => \{\}|setTitle: \(\) => \{\}" packages/cli/src/app-server   # no matches
rg -n "dangerouslySetInnerHTML|innerHTML|<iframe|<img" apps/desktop/src/renderer/components/view.tsx   # no matches
rg -n "#[0-9a-fA-F]{3,8}\b|rgb\(" apps/desktop/src/renderer/components/view.tsx         # no matches
rg -nU "^import \{[^}]*\} from \"@knightcode/app-server-protocol\"" apps/desktop/src/renderer   # no matches: types only
rg -n "event\.key ===|e\.key ===" apps/desktop/src/renderer                              # no matches
git diff --stat origin/main -- packages/agent packages/ai packages/cli/src/modes/rpc packages/cli/src/core/extensions/runner.ts packages/cli/src/core/agent-session.ts   # empty
git diff --name-only origin/main -- packages/cli/src/core   # core/extensions/types.ts, core/extensions/index.ts, core/index.ts, core/system-prompt.ts only
```

Manual, on Windows with `cd apps/desktop && bun run start`, in a throwaway
project whose `.knightcode/extensions/` holds a copy of the example
(`resource-loader.ts:1044`) and which is trusted in the app: the widget panel
shows above the composer;
Reset and the toggle change it; a status chip and the window title show;
calling `check_summary` shows a table in its tool row; a second window on the
same thread shows the same widget; after killing the server
(`taskkill /F`) the restarted thread shows the widget again. In the terminal
(`bun run start -e …`), the widget and the tool's table draw.

## 10. Stop condition

Phase C is complete when:

- A desktop thread shows its extensions' status chips, title, working message
  and widgets, including in a second window and after a server restart.
- Views draw in widgets, tool rows and extension messages in both the desktop
  app and the terminal, from the same extension code; widget buttons and
  fields reach `onViewEvent` handlers on the desktop.
- Terminal-only UI is reported once per method per thread load instead of
  vanishing.
- The only system-prompt change is the one docs entry, pinned by a test.
- The runner, the harness and RPC mode are unchanged.
- The required tests pass, both type checks are clean, and every validation
  grep matches as stated.

## Review history

Nine review rounds with KnightCode (2026-10-22, blockers and majors only)
found 7, 4, 4, 2, 1, 1, 1, 3 and 0 issues, each checked against the code, the
claims about TypeBox and JSON by running them. Round 9 rated v9 ready.

- Round 1: an owned copy of each widget, a depth check ahead of the recursive
  schema check, bounded keys, the reload clear moved after
  `session_shutdown`, load-time refusals as load warnings, views on nested
  tool calls, a props-only widget panel for static rendering.
- Round 2: one `checkView` that copies through JSON and checks the copy, no
  "unchanged" shortcut for widgets, no length cap on event values.
- Round 3: schema regeneration before the freshness test, and
  `JSON.stringify(undefined)` refused. Declined into section 8: results an
  extension mutates after returning them, and the unbuilt load-warning
  banner.
- Round 4: an inline-turn fixture for the page-budget test; handlers dropped
  when a reload begins and state cleared when it fails.
- Rounds 5 and 6: an optional `result` in the terminal fallback, and
  `details` of a `CustomMessage<unknown>` narrowed before reading `view`.
- Round 7: overlapping resumes of one thread can install an older snapshot.
  The race predates Phase C (turns and the queue have it). A per-thread
  counter added for it drew two of round 8's three findings (server requests
  lost from a superseded resume's buffer, replay racing another install), so
  it was cut: the race is listed in section 8 as its own change.
- Round 8's third finding: a tool's view wins over the desktop's name-based
  cards (`toolBody`).
