import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@knightcodeai/cli";
import { truncateHead } from "@knightcodeai/cli/core/tools/truncate";
import type { RegisteredToolEntry } from "./registry.ts";
import { readPersisted, resolveEnabled } from "./state.ts";

export const SCRATCHPAD = "scratchpad";
export const NOTES_FILE = "notes.md";
/** One restore never re-sends more than about 2k tokens. */
export const NOTES_MAX_BYTES = 8 * 1024;

export const scratchpadEntry: RegisteredToolEntry = {
	tool: { name: SCRATCHPAD, feature: true },
	defaultEnabled: false,
};

/**
 * The session's scratchpad under the OS temp dir. The uid keeps users sharing a POSIX /tmp from
 * colliding on the parent directory; the Windows temp dir is already per-user.
 */
export function scratchpadDir(sessionId: string, base = tmpdir()): string {
	const owner = process.getuid ? `knightcode-${process.getuid()}` : "knightcode";
	return join(base, owner, SCRATCHPAD, sessionId);
}

/** Fixed for the session, so it rides in the cached first system message and is never re-sent. */
export function scratchpadSection(dir: string): string {
	return [
		`Session scratchpad: ${dir.replace(/\\/g, "/")}`,
		"Put temporary files (scripts, intermediate output) here, not in the project or /tmp.",
		`Keep working notes (task list, decisions, file:line facts, next steps) in ${NOTES_FILE} here; it is restored after compaction.`,
	].join("\n");
}

/** notes.md framed for the model, or undefined when there is nothing to restore. */
export function restoredNotes(dir: string): string | undefined {
	const path = join(dir, NOTES_FILE);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		// A missing or unreadable file restores nothing; the file itself is never touched.
		return undefined;
	}
	if (text.trim() === "") return undefined;
	const shown = path.replace(/\\/g, "/");
	const cut = truncateHead(text, { maxBytes: NOTES_MAX_BYTES });
	const rest = cut.truncated ? `\n\n[truncated; read ${shown} for the rest]` : "";
	return `Your scratchpad notes (${shown}), restored after compaction:\n\n${cut.content}${rest}`;
}

/**
 * A prompt section naming the session's scratchpad, and a one-time restore of its notes.md after
 * each compaction. Both read the /tools state on every call, so a change applies from the next prompt.
 * ponytail: /fork starts a new, empty directory; copy the parent's on fork if users ask for it.
 */
export function registerScratchpad(pi: ExtensionAPI, base = tmpdir()): void {
	const enabled = () => resolveEnabled(SCRATCHPAD, scratchpadEntry.defaultEnabled, readPersisted());
	pi.on("before_agent_start", (event, ctx) => {
		if (!enabled()) return;
		const dir = scratchpadDir(ctx.sessionManager.getSessionId(), base);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		event.systemPromptOptions.sections[SCRATCHPAD] = scratchpadSection(dir);
	});
	pi.on("session_compact", (_event, ctx) => {
		if (!enabled()) return;
		const notes = restoredNotes(scratchpadDir(ctx.sessionManager.getSessionId(), base));
		// Idle, this is appended at once. Mid-run it is steered, and the agent loop picks steering up
		// after compaction and before the next response.
		if (notes) pi.sendMessage({ customType: "scratchpad-notes", content: notes, display: false });
	});
}
