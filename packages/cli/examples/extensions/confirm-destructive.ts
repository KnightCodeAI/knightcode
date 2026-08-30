/**
 * Confirm Destructive Actions Extension
 *
 * Prompts for confirmation before destructive session actions (clear, switch, branch).
 * Demonstrates how to cancel session events using the before_* events.
 */

import type { ExtensionAPI, SessionBeforeSwitchEvent, SessionMessageEntry } from "@knightcodeai/cli";

export default function (knightcode: ExtensionAPI) {
	knightcode.on("session_before_switch", async (event: SessionBeforeSwitchEvent, ctx) => {
		if (!ctx.hasUI) return;

		if (event.reason === "new") {
			const confirmed = await ctx.ui.confirm("Clear session?", "This will delete all messages in the current session.");

			if (!confirmed) {
				ctx.ui.notify("Clear cancelled", "info");
				return { cancel: true };
			}
			return;
		}

		// reason === "resume" - check if there are unsaved changes (messages since last assistant response).
		// Scanning the whole session instead would prompt on every resume of a completed session.
		const entries = ctx.sessionManager.getEntries();
		const lastAssistantIndex = entries.findLastIndex(
			(e): e is SessionMessageEntry => e.type === "message" && e.message.role === "assistant",
		);
		const hasUnsavedWork = entries
			.slice(lastAssistantIndex + 1)
			.some((e): e is SessionMessageEntry => e.type === "message" && e.message.role === "user");

		if (hasUnsavedWork) {
			const confirmed = await ctx.ui.confirm(
				"Switch session?",
				"You have messages in the current session. Switch anyway?",
			);

			if (!confirmed) {
				ctx.ui.notify("Switch cancelled", "info");
				return { cancel: true };
			}
		}
	});

	knightcode.on("session_before_fork", async (event, ctx) => {
		if (!ctx.hasUI) return;

		const choice = await ctx.ui.select(`Fork from entry ${event.entryId.slice(0, 8)}?`, [
			"Yes, create fork",
			"No, stay in current session",
		]);

		if (choice !== "Yes, create fork") {
			ctx.ui.notify("Fork cancelled", "info");
			return { cancel: true };
		}
	});
}
