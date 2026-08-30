/**
 * Auto-Commit on Exit Extension
 *
 * Automatically commits changes when the agent exits.
 * Uses the last assistant message to generate a commit message.
 */

import type { ExtensionAPI } from "@knightcodeai/cli";

export default function (knightcode: ExtensionAPI) {
	knightcode.on("session_shutdown", async (event, ctx) => {
		// Only commit when the process is really exiting. session_shutdown also fires when the
		// session is replaced (reload/new/resume/fork), and those must not create commits.
		if (event.reason !== "quit") return;

		// Check for uncommitted changes
		const { stdout: status, code } = await knightcode.exec("git", ["status", "--porcelain"]);

		if (code !== 0 || status.trim().length === 0) {
			// Not a git repo or no changes
			return;
		}

		// Find the last assistant message for commit context
		const entries = ctx.sessionManager.getEntries();
		let lastAssistantText = "";
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				const content = entry.message.content;
				if (Array.isArray(content)) {
					lastAssistantText = content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");
				}
				break;
			}
		}

		// Generate a simple commit message
		const firstLine = lastAssistantText.split("\n")[0] || "Work in progress";
		const commitMessage = `[knightcode] ${firstLine.slice(0, 50)}${firstLine.length > 50 ? "..." : ""}`;

		// Stage and commit. Bail on a failed stage: committing anyway would capture whatever was
		// already staged rather than the work this shutdown was meant to save.
		const { code: addCode } = await knightcode.exec("git", ["add", "-A"]);
		if (addCode !== 0) return;
		const { code: commitCode } = await knightcode.exec("git", ["commit", "-m", commitMessage]);

		if (commitCode === 0 && ctx.hasUI) {
			ctx.ui.notify(`Auto-committed: ${commitMessage}`, "info");
		}
	});
}
