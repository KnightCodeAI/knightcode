import { basename } from "node:path";
import { contentText, type UserMessage } from "@knightcode/ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionBeforeTreeResult,
} from "../../core/extensions/types.ts";
import type { SessionEntry, SessionMessageEntry } from "../../core/session-manager.ts";
import { resolveToCwd } from "../../core/tools/path-utils.ts";
import { FileHistory } from "./history.ts";
import { UndoPicker, type UndoRow } from "./picker.ts";

const FILE_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const CONVERSATION_ONLY = "Conversation only";

function isUserMessage(entry: SessionEntry | undefined): entry is SessionMessageEntry & { message: UserMessage } {
	return entry?.type === "message" && entry.message.role === "user";
}

function checkpointsDisabled(): boolean {
	const value = process.env.KNIGHTCODE_DISABLE_FILE_CHECKPOINTS?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/**
 * `/undo`: go back to an earlier user message, undoing the turns after it and, on request,
 * the file edits those turns made. Conversation rewind is core's `navigateTree`; this
 * extension adds the user-message picker and copy-on-write file backups taken right before
 * `edit`/`write` run. Every navigation (`/undo`, `/tree`, double-Escape) goes through the
 * same `session_before_tree` prompt, so there is one restore path.
 */
export default function undoExtension(pi: ExtensionAPI): void {
	// Extensions are re-instantiated on fork/resume, so the store is looked up per session id
	// and everything durable lives in its index file.
	let history: { sessionId: string; store: FileHistory } | undefined;
	const historyFor = (ctx: ExtensionContext): FileHistory => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (history?.sessionId !== sessionId) history = { sessionId, store: FileHistory.forSession(sessionId) };
		return history.store;
	};
	// Decision taken in session_before_tree, applied in session_tree once the leaf has moved.
	let pending: { files?: Map<string, string | null>; notice?: string } | undefined;
	// Records made by tool calls still running, so a failed call can take its record back.
	const recordedBy = new Map<string, { entryId: string; path: string }>();

	pi.on("tool_execution_start", (event, ctx) => {
		if (checkpointsDisabled()) return;
		const isFile = FILE_TOOLS.has(event.toolName);
		if (!isFile && !SHELL_TOOLS.has(event.toolName)) return;
		const current = ctx.sessionManager.getBranch().findLast(isUserMessage);
		if (!current) return;
		if (!isFile) {
			historyFor(ctx).markShell(current.id);
			return;
		}
		// Raw model arguments, not yet validated: a bad call is rejected later by the tool.
		const path: unknown = event.args?.path;
		if (typeof path !== "string") return;
		const absPath = resolveToCwd(path, ctx.cwd);
		if (historyFor(ctx).record(current.id, absPath)) {
			recordedBy.set(event.toolCallId, { entryId: current.id, path: absPath });
		}
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const made = recordedBy.get(event.toolCallId);
		recordedBy.delete(event.toolCallId);
		// A failed write created nothing, so a "did not exist" record would wrongly delete a
		// file that something else creates later.
		if (made && event.isError) historyFor(ctx).forget(made.entryId, made.path);
	});

	pi.on("session_before_tree", async (event, ctx): Promise<SessionBeforeTreeResult | undefined> => {
		pending = undefined;
		if (checkpointsDisabled() || !ctx.hasUI) return;
		const { preparation } = event;
		const store = historyFor(ctx);
		// entriesToSummarize is the old branch back to the common ancestor; a user-message
		// target moves the leaf to its parent, so the target's own turn is abandoned too.
		const target = ctx.sessionManager.getEntry(preparation.targetId);
		const ids = preparation.entriesToSummarize.filter(isUserMessage).map((entry) => entry.id);
		if (isUserMessage(target) || target?.type === "custom_message") ids.unshift(target.id);
		const abandoned = store.abandoned(ids);
		if (abandoned.files.size === 0) {
			const notices = [];
			if (abandoned.failed) notices.push("Some file backups failed, so nothing was restored.");
			if (abandoned.shellRan) notices.push("Shell commands ran after this point; their file changes are not tracked.");
			if (notices.length > 0) pending = { notice: notices.join(" ") };
			return;
		}

		const count = abandoned.files.size;
		let label = `Conversation and ${count} file${count === 1 ? "" : "s"}`;
		if (abandoned.shellRan) label += " (shell commands also ran; those changes are not tracked)";
		if (abandoned.failed) label += " (some backups failed)";
		const choice = await ctx.ui.select("Restore files?", [CONVERSATION_ONLY, label], { signal: event.signal });
		if (choice === undefined) return { cancel: true };
		if (choice !== CONVERSATION_ONLY) pending = { files: abandoned.files };
	});

	pi.on("session_tree", (_event, ctx) => {
		const job = pending;
		pending = undefined;
		if (!job) return;
		let notice = job.notice;
		let level: "info" | "warning" = "warning";
		if (job.files) {
			const result = historyFor(ctx).restore(job.files);
			notice = `Restored ${result.restored} file${result.restored === 1 ? "" : "s"}`;
			if (result.failed.length > 0) notice += `; failed: ${result.failed.join(", ")}`;
			else level = "info";
		}
		// Interactive mode redraws the chat right after navigateTree returns, which would wipe
		// a notice shown now. If the session is gone by the time the timer fires, the ctx
		// throws its stale error and there is nobody to tell.
		if (notice) {
			setTimeout(() => {
				try {
					ctx.ui.notify(notice, level);
				} catch {}
			}, 0);
		}
	});

	pi.on("session_shutdown", (event, ctx) => {
		if (event.reason !== "fork" || !event.targetSessionFile) return;
		// Fork keeps entry ids and writes `${timestamp}_${sessionId}.jsonl`.
		const name = basename(event.targetSessionFile);
		historyFor(ctx).copyTo(name.slice(name.indexOf("_") + 1, -".jsonl".length));
	});

	pi.on("session_start", () => {
		try {
			FileHistory.prune(30);
		} catch {
			// Housekeeping only.
		}
	});

	pi.registerCommand("undo", {
		description: "Go back to an earlier message, undoing the turns after it and optionally their file changes",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish before undoing.", "warning");
				return;
			}
			const messages = ctx.sessionManager
				.getBranch()
				.filter(isUserMessage)
				.map((entry) => ({ entry, text: contentText(entry.message.content, "") }))
				.filter(({ text }) => text.length > 0);
			if (messages.length === 0) {
				ctx.ui.notify("Nothing to undo", "info");
				return;
			}
			const store = historyFor(ctx);
			const rows: UndoRow[] = messages.map(({ entry, text }, i) => {
				const abandoned = store.abandoned(messages.slice(i).map((m) => m.entry.id));
				return {
					id: entry.id,
					text,
					timestamp: entry.timestamp,
					files: abandoned.files.size,
					shellRan: abandoned.shellRan,
				};
			});
			const id = await pickRow(ctx, rows);
			if (id) await ctx.navigateTree(id);
		},
	});
}

async function pickRow(ctx: ExtensionCommandContext, rows: UndoRow[]): Promise<string | undefined> {
	if (ctx.mode === "tui") {
		return ctx.ui.custom<string | undefined>(
			(_tui, _theme, keybindings, done) => new UndoPicker(rows, keybindings, done),
		);
	}
	// No component host outside the TUI: a numbered list, newest first.
	const newestFirst = [...rows].reverse();
	const labels = newestFirst.map((row, i) => `${i + 1}. ${row.text.split("\n")[0]}`);
	const choice = await ctx.ui.select("Undo to message", labels);
	if (choice === undefined) return undefined;
	return newestFirst[labels.indexOf(choice)]?.id;
}
