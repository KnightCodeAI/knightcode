# Declarative Views

A view is a small tree of data that describes what to draw: text, markdown, a
table, a progress bar, a button. An extension hands one to a widget, a tool
result or an extension message, and every client draws it with its own
components: the terminal with TUI components, the [desktop app](desktop.md) with
its own. A view is data only. It never holds HTML, scripts or URLs that load.

```ts
import type { View } from "knightcode";

const view: View = {
	type: "stack",
	children: [
		{ type: "text", text: "2 checks failed", tone: "error" },
		{ type: "table", columns: ["check", "result"], rows: [["parser", "failed"], ["lexer", "failed"]] },
		{ type: "button", id: "rerun", label: "Run again" },
	],
};
```

## Nodes

| Node | Fields | Example |
| --- | --- | --- |
| `text` | `text`, optional `tone`: `muted`, `accent`, `success`, `warning`, `error` | `{type: "text", text: "Saved", tone: "success"}` |
| `markdown` | `markdown`; raw HTML shows as text, images do not load | `{type: "markdown", markdown: "**3** files"}` |
| `stack` | `children`, optional `direction`: `vertical` (default) or `horizontal` | `{type: "stack", direction: "horizontal", children: [...]}` |
| `list` | `items`, each a view, drawn as bullets | `{type: "list", items: [{type: "text", text: "one"}]}` |
| `table` | `columns` (at least one), `rows` of strings, each row as wide as `columns` | `{type: "table", columns: ["a"], rows: [["1"]]}` |
| `progress` | `value` (0 or more), `max` (over 0), optional `label`; a value over `max` draws full | `{type: "progress", value: 3, max: 10, label: "tests"}` |
| `button` | `id` (1 to 128 characters), `label` | `{type: "button", id: "reset", label: "Reset"}` |
| `field` | `id`, `kind`: `text`, `toggle` or `select`, `label`, `value`, and `options` for a select | `{type: "field", id: "mode", kind: "select", label: "Mode", value: "fast", options: ["fast", "slow"]}` |

## Rules and limits

A view that breaks a rule is refused as a whole:

- No members other than those above, and no other node types.
- Stacks and lists nest at most 8 levels.
- Control ids (`button` and `field`) are unique within the view.
- A toggle's `value` is a boolean; a text or select field's is a string. A
  select has `options` and its `value` is one of them; a text field or toggle
  has no `options`.
- Its JSON is at most 64 KiB in a tool result or an extension message, and at
  most 16 KiB in a widget.

The view is copied through JSON when it is used, so a getter, a `toJSON` or a
change you make to the object later does not change what was drawn. Call
`setWidget` again to change a widget.

Terminal escape sequences and control characters other than tab and newline
are removed from every string of the copy, so colour a view with `tone`, not
ANSI codes.

A thread shows at most 16 widgets and 50 statuses, with keys of 1 to 128
characters. Status text, the title and the working message are cut to 200
characters and kept on one line.

## Widgets

```ts
ctx.ui.setWidget("checks:summary", view, { placement: "aboveEditor" });
ctx.ui.setWidget("checks:summary", undefined); // remove it
```

`placement` is `aboveEditor` (the default) or `belowEditor`. Widget and status
keys are shared by every extension of a thread, so prefix them with your
extension's name. In the terminal, an invalid view draws one warning line in
its place; the app server sends nothing and reports it once per key as a
warning.

## Tool results and extension messages

Put a view in `details.view` and clients draw it in place of the text output:

```ts
return { content: [{ type: "text", text: "parser: failed" }], details: { view } };

knightcode.sendMessage({ customType: "checks", content: "2 failed", display: true, details: { view } });
```

Keep the text content meaningful: the model reads it, not the view, and a client
that cannot draw the view shows the text. An invalid view is ignored and the
text shows. In the terminal a tool's own `renderResult`, or a registered message
renderer, still wins over the view.

## Buttons and fields

In a widget on the desktop app, buttons and fields are live. A press or a
change reaches every handler the thread's extensions registered:

```ts
ctx.ui.onViewEvent?.((event) => {
	if (event.widgetKey !== "checks:summary") return;
	if (event.id === "rerun") runChecks();
	if (event.id === "verbose" && typeof event.value === "boolean") verbose = event.value;
	ctx.ui.setWidget("checks:summary", render());
});
```

`event` is `{widgetKey, id, value?}`: `value` is a string for a text or select
field, a boolean for a toggle, absent for a button. A field shows the value in
the view, so answer a change by setting the widget again. `onViewEvent` is
present only where widgets are interactive; the `?.` keeps the code working
elsewhere. A handler that throws becomes a warning in the app.

## Where views draw

| Client | Widgets | Tool results and messages | Controls |
| --- | --- | --- | --- |
| Terminal | yes | yes | drawn as text |
| Desktop app | yes | yes | live in widgets, disabled elsewhere |
| RPC, JSON and print modes | no | no | no |

[`examples/extensions/desktop-view.ts`](../examples/extensions/desktop-view.ts)
puts all of it together. For the protocol side see
[app-server.md](app-server.md#dialogs-and-extension-ui).
