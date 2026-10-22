/**
 * Dialogs and extension UI for desktop threads (§8.1, §8.2): what KnightCode asks the user mid-turn, such as the
 * classifier gate's confirm and plan review, goes to a subscriber as `ui/dialog`, and ask_user's questions, all at
 * once, as `item/toolCall/requestUserInput`; both are asked as approvals are (§4.5). Notices go to every subscriber
 * as `ui/notify`. Statuses, the title, the working row and widgets are kept per thread in `ExtensionUiState`, sent
 * as `ui/state` and `ui/widget`, and handed whole to a client that opens the thread. What only a terminal can draw
 * (widget factories, header, footer, custom components, raw input) is reported once per load in the log.
 */

import {
	checkView,
	type ServerRequestParams,
	type UiSnapshot,
	type View,
	WIDGET_MAX_BYTES,
	type Widget,
} from "@knightcode/app-server-protocol";
import type { QuestionsUI } from "@knightcode/tools/ask/tool";
import type { ExtensionUIContext, ExtensionUIDialogOptions, ViewEvent } from "../core/extensions/types.ts";
import { theme } from "../modes/interactive/theme/theme.ts";
import { stripAnsi } from "../utils/ansi.ts";
import { askSubscribers } from "./approvals.ts";
import { AppServerError } from "./errors.ts";
import { type LoadedThread, titleOf } from "./loaded-thread.ts";

type Dialog = Omit<ServerRequestParams<"ui/dialog">, "threadId">;
type ViewHandler = (event: ViewEvent) => void | Promise<void>;

const MAX_WIDGETS = 16;
const MAX_STATUSES = 50;
const MAX_KEY_LENGTH = 128;
/** Refusals reported per load: an extension inventing a new invalid key each time cannot grow the log or warnings. */
const MAX_REPORTED = 64;

/** A loaded thread's extension UI as it stands, and what was already reported about it in this load. */
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
	readonly handlers = new Set<ViewHandler>();
	/** Terminal-only methods and refused keys already reported in this load. */
	readonly reported = new Set<string>();

	/** The `ui/state` fields: statuses sorted by key, as the terminal footer shows them. */
	state(): Omit<UiSnapshot, "widgets"> {
		return {
			statuses: [...this.statuses].sort(([a], [b]) => a.localeCompare(b)).map(([key, text]) => ({ key, text })),
			...(this.title === undefined ? {} : { title: this.title }),
			...(this.workingMessage === undefined ? {} : { workingMessage: this.workingMessage }),
			workingVisible: this.workingVisible,
		};
	}

	/** The `ui` of a start, resume or fork result; widgets ordered above, then below. */
	snapshot(): UiSnapshot {
		const widgets = [...this.widgets.values()];
		return {
			...this.state(),
			widgets: [
				...widgets.filter((widget) => widget.placement === "aboveEditor"),
				...widgets.filter((widget) => widget.placement === "belowEditor"),
			],
		};
	}

	/**
	 * Deliver a widget control's event to every handler, each in its own microtask; a failure becomes a `warning`.
	 * A widget or control that is gone (a stale click) delivers nothing. A value that does not fit the control
	 * throws AppServerError("invalidParams").
	 */
	dispatch(thread: LoadedThread, event: ViewEvent): void {
		const widget = this.widgets.get(event.widgetKey);
		const control = widget && "view" in widget ? findControl(widget.view, event.id) : undefined;
		if (!control) return;
		const { value } = event;
		const fits =
			control.type === "button"
				? value === undefined
				: control.kind === "toggle"
					? typeof value === "boolean"
					: typeof value === "string" && (control.kind === "text" || control.options?.includes(value) === true);
		if (!fits)
			throw new AppServerError(
				"invalidParams",
				`${JSON.stringify(value)} is not a value for ${control.type === "button" ? "the button" : `the ${control.kind} field`} "${control.id}"`,
			);
		const report = (error: unknown) => {
			const message = `A view event handler failed: ${error instanceof Error ? error.message : String(error)}`;
			console.error(`app-server: thread ${thread.id}: ${message}`);
			thread.notify("warning", { source: "extension", threadId: thread.id, message });
		};
		for (const handler of [...this.handlers]) {
			Promise.resolve()
				.then(() => handler({ ...event }))
				.catch(report);
		}
	}

	/** Forget everything and tell the subscribers (D16). */
	clear(thread: LoadedThread): void {
		const anything =
			this.statuses.size > 0 ||
			this.title !== undefined ||
			this.workingMessage !== undefined ||
			!this.workingVisible ||
			this.widgets.size > 0;
		const keys = [...this.widgets.keys()];
		this.statuses.clear();
		this.widgets.clear();
		this.title = undefined;
		this.workingMessage = undefined;
		this.workingVisible = true;
		this.handlers.clear();
		this.reported.clear();
		if (!anything) return;
		thread.notify("ui/state", { threadId: thread.id, ...this.state() });
		for (const key of keys) thread.notify("ui/widget", { threadId: thread.id, key });
	}
}

type Control = Extract<View, { type: "button" | "field" }>;

/** The button or field with `id`, depth first; ids are unique within a view (checkView). */
function findControl(view: View, id: string): Control | undefined {
	if (view.type === "button" || view.type === "field") return view.id === id ? view : undefined;
	if (view.type !== "stack" && view.type !== "list") return undefined;
	for (const child of view.type === "stack" ? view.children : view.items) {
		const found = findControl(child, id);
		if (found) return found;
	}
	return undefined;
}

/** One line for a status, title or working message: no escapes, no line breaks, at most 200 code points (D12). */
function clean(text: unknown): string {
	const folded = stripAnsi(String(text))
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
	return titleOf(folded, "");
}

/** A widget's lines, copied through JSON as checkView copies a view, or why they were refused. */
function checkLines(content: unknown[]): { lines: string[] } | { error: string } {
	let json: string;
	try {
		json = JSON.stringify(content);
	} catch (error) {
		return { error: `the lines have no JSON form: ${error instanceof Error ? error.message : String(error)}` };
	}
	const bytes = Buffer.byteLength(json);
	if (bytes > WIDGET_MAX_BYTES) return { error: `the lines are ${bytes} bytes, over ${WIDGET_MAX_BYTES} bytes` };
	const copy = JSON.parse(json) as unknown[];
	if (!copy.every((line): line is string => typeof line === "string")) return { error: "a line is not a string" };
	return { lines: copy.map(stripAnsi) };
}

export function desktopDialogs(thread: LoadedThread): ExtensionUIContext & QuestionsUI {
	/** Undefined when cancelled, aborted, timed out, or nobody is subscribed. */
	const request = async <M extends "ui/dialog" | "item/toolCall/requestUserInput">(
		method: M,
		params: ServerRequestParams<M>,
		opts?: ExtensionUIDialogOptions,
	) => {
		if (opts?.signal?.aborted) return undefined;
		const controller = new AbortController();
		const abort = () => controller.abort();
		opts?.signal?.addEventListener("abort", abort, { once: true });
		const timer = opts?.timeout ? setTimeout(abort, opts.timeout) : undefined;
		// Closing the thread aborts it with the approvals (LoadedThread.abortPending).
		thread.pending.add(controller);
		try {
			return await askSubscribers(thread, method, params, controller.signal);
		} finally {
			clearTimeout(timer);
			thread.pending.delete(controller);
			opts?.signal?.removeEventListener("abort", abort);
		}
	};
	const ask = (dialog: Dialog, opts?: ExtensionUIDialogOptions) =>
		request("ui/dialog", { threadId: thread.id, ...dialog }, opts);
	const { ui } = thread;
	const sendState = () => thread.notify("ui/state", { threadId: thread.id, ...ui.state() });
	/**
	 * One warning per key per load, delivered as extension errors are: live, or with the load's warnings. At most
	 * MAX_REPORTED in a load.
	 */
	const refuse = (kind: "status" | "widget", key: unknown, reason: string) => {
		const name = String(key).slice(0, MAX_KEY_LENGTH);
		if (ui.reported.has(`${kind}:${name}`) || ui.reported.size >= MAX_REPORTED) return;
		ui.reported.add(`${kind}:${name}`);
		const message = `${kind === "status" ? "Status" : "Widget"} "${name}" was not shown: ${reason}`;
		console.error(`app-server: thread ${thread.id}: ${message}`);
		if (thread.subscribers.size > 0) thread.notify("warning", { source: "extension", threadId: thread.id, message });
		else thread.loadWarnings.push({ source: "extension", message });
	};
	const badKey = (key: unknown) =>
		typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH
			? `the key must be 1 to ${MAX_KEY_LENGTH} characters`
			: undefined;
	/** D6: drawn only in the terminal; said once per method per load, so a redraw loop does not flood the log. */
	const terminalOnly = (method: string, key?: string) => {
		if (ui.reported.has(method)) return;
		ui.reported.add(method);
		const args = key === undefined ? "" : JSON.stringify(key);
		console.error(
			`app-server: thread ${thread.id}: ${method}(${args}) draws only in the terminal; the desktop app ignores it`,
		);
	};
	const removeWidget = (key: string) => {
		if (ui.widgets.delete(key)) thread.notify("ui/widget", { threadId: thread.id, key });
	};
	const setWidget = (key: string, content: unknown, options?: { placement?: Widget["placement"] }) => {
		const invalid = badKey(key);
		if (invalid) return refuse("widget", key, invalid);
		if (content === undefined) return removeWidget(key);
		if (typeof content === "function") {
			// The key moved to a factory: what it showed before is stale.
			removeWidget(key);
			return terminalOnly("setWidget", key);
		}
		const checked = Array.isArray(content) ? checkLines(content) : checkView(content, WIDGET_MAX_BYTES);
		if ("error" in checked) return refuse("widget", key, checked.error);
		if (!ui.widgets.has(key) && ui.widgets.size >= MAX_WIDGETS)
			return refuse("widget", key, `a thread shows at most ${MAX_WIDGETS} widgets`);
		const placement = options?.placement === "belowEditor" ? "belowEditor" : "aboveEditor";
		const widget: Widget =
			"lines" in checked ? { key, placement, lines: checked.lines } : { key, placement, view: checked.view };
		// Delete first so the key moves last, as the terminal's setExtensionWidget does. Even identical content
		// reorders, so there is no "unchanged" shortcut.
		ui.widgets.delete(key);
		ui.widgets.set(key, widget);
		thread.notify("ui/widget", { threadId: thread.id, ...widget });
	};
	return {
		// ask_user finds this and shows all its questions at once (packages/tools/src/ask/tool.ts, QuestionsUI).
		askQuestions: async (questions, { toolCallId, signal }) =>
			(
				await request(
					"item/toolCall/requestUserInput",
					{ threadId: thread.id, turnId: thread.mapper.currentTurnId() ?? "", itemId: toolCallId, questions },
					{ signal },
				)
			)?.answers,
		// Only an offered option is a choice: anything else (a stale or buggy client) is a cancel.
		select: async (title, options, opts) => {
			const value = (await ask({ kind: "select", title, options }, opts))?.value;
			return value !== undefined && options.includes(value) ? value : undefined;
		},
		confirm: async (title, message, opts) => (await ask({ kind: "confirm", title, message }, opts))?.confirmed === true,
		input: async (title, placeholder, opts) =>
			(await ask({ kind: "input", title, ...(placeholder ? { placeholder } : {}) }, opts))?.value,
		editor: async (title, prefill) => (await ask({ kind: "editor", title, ...(prefill ? { prefill } : {}) }))?.value,
		notify: (message, level = "info") => thread.notify("ui/notify", { threadId: thread.id, message, level }),
		onViewEvent: (handler) => {
			ui.handlers.add(handler);
			return () => {
				ui.handlers.delete(handler);
			};
		},
		onTerminalInput: () => {
			terminalOnly("onTerminalInput");
			return () => {};
		},
		setStatus: (key, text) => {
			const invalid = badKey(key);
			if (invalid) return refuse("status", key, invalid);
			const value = text === undefined ? "" : clean(text);
			if (!value) {
				if (ui.statuses.delete(key)) sendState();
				return;
			}
			if (ui.statuses.get(key) === value) return;
			if (!ui.statuses.has(key) && ui.statuses.size >= MAX_STATUSES)
				return refuse("status", key, `a thread shows at most ${MAX_STATUSES} statuses`);
			ui.statuses.set(key, value);
			sendState();
		},
		setWorkingMessage: (message) => {
			const value = message === undefined ? undefined : clean(message) || undefined;
			if (ui.workingMessage === value) return;
			ui.workingMessage = value;
			sendState();
		},
		setWorkingVisible: (visible) => {
			if (ui.workingVisible === Boolean(visible)) return;
			ui.workingVisible = Boolean(visible);
			sendState();
		},
		setWorkingIndicator: (options) => {
			if (options) terminalOnly("setWorkingIndicator");
		},
		// D8: desktop reasoning rows have no hidden-thinking state.
		setHiddenThinkingLabel: () => {},
		setWidget,
		setFooter: (factory) => {
			if (factory) terminalOnly("setFooter");
		},
		setHeader: (factory) => {
			if (factory) terminalOnly("setHeader");
		},
		setTitle: (title) => {
			const value = clean(title) || undefined;
			if (ui.title === value) return;
			ui.title = value;
			sendState();
		},
		custom: async () => {
			terminalOnly("custom");
			return undefined as never;
		},
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		get theme() {
			return theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "The desktop app has its own themes" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
