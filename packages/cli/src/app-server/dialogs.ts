/**
 * Dialogs for desktop threads (§8.1): what KnightCode asks the user mid-turn, such as the classifier gate's confirm
 * and plan review, goes to a subscriber as `ui/dialog`, and ask_user's questions, all at once, as
 * `item/toolCall/requestUserInput`; both are asked as approvals are (§4.5). Notices go to every subscriber as
 * `ui/notify`. What only a terminal can draw (widgets, header, footer, custom
 * components, raw input) does nothing, as in RPC mode.
 */

import type { ServerRequestParams } from "@knightcode/app-server-protocol";
import type { QuestionsUI } from "@knightcode/tools/ask/tool";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../core/extensions/types.ts";
import { theme } from "../modes/interactive/theme/theme.ts";
import { askSubscribers } from "./approvals.ts";
import type { LoadedThread } from "./loaded-thread.ts";

type Dialog = Omit<ServerRequestParams<"ui/dialog">, "threadId">;

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
