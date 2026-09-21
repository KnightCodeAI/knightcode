import { lstatSync, mkdirSync, readFileSync } from "node:fs";
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
 * The uid keeps users sharing a POSIX /tmp from colliding on this directory; the Windows temp dir
 * is already per-user.
 */
function ownerDir(base: string): string {
	return join(base, process.getuid ? `knightcode-${process.getuid()}` : "knightcode");
}

/** The session's scratchpad under the OS temp dir. */
export function scratchpadDir(sessionId: string, base = tmpdir()): string {
	return join(ownerDir(base), SCRATCHPAD, sessionId);
}

/**
 * Creates the session's scratchpad and returns it. Another user on a shared POSIX /tmp can create
 * the parent first, and notes.md goes back into the model's context, so a parent that is not a
 * private directory of this user is refused.
 */
export function openScratchpad(sessionId: string, base = tmpdir()): string {
	const uid = process.getuid?.();
	if (uid !== undefined) {
		const owner = ownerDir(base);
		mkdirSync(owner, { recursive: true, mode: 0o700 });
		const stat = lstatSync(owner);
		if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
			throw new Error(`Scratchpad off: ${owner} is not a private directory owned by you`);
		}
	}
	const dir = scratchpadDir(sessionId, base);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	return dir;
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
	// truncateHead keeps whole lines only, so a first line over the cap would restore nothing. Cut it
	// by bytes instead; a streaming decode drops a character split at the cut.
	const content = cut.firstLineExceedsLimit
		? new TextDecoder().decode(Buffer.from(text).subarray(0, NOTES_MAX_BYTES), { stream: true })
		: cut.content;
	const rest = cut.truncated ? `\n\n[truncated; read ${shown} for the rest]` : "";
	return `Your scratchpad notes (${shown}), restored after compaction:\n\n${content}${rest}`;
}

/**
 * A prompt section naming the session's scratchpad, and a one-time restore of its notes.md after
 * each compaction. Both read the /tools state on every call, so a change applies from the next prompt.
 * ponytail: /fork starts a new, empty directory; copy the parent's on fork if users ask for it.
 */
export function registerScratchpad(pi: ExtensionAPI, base = tmpdir()): void {
	const enabled = () => resolveEnabled(SCRATCHPAD, scratchpadEntry.defaultEnabled, readPersisted());
	// True from agent_start to agent_end. A compaction inside the loop is followed by a response.
	let looping = false;
	pi.on("agent_start", () => {
		looping = true;
	});
	pi.on("agent_end", () => {
		looping = false;
	});
	pi.on("before_agent_start", (event, ctx) => {
		if (!enabled()) return;
		const dir = openScratchpad(ctx.sessionManager.getSessionId(), base);
		event.systemPromptOptions.sections[SCRATCHPAD] = scratchpadSection(dir);
	});
	pi.on("session_compact", (event, ctx) => {
		if (!enabled()) return;
		const notes = restoredNotes(openScratchpad(ctx.sessionManager.getSessionId(), base));
		if (!notes) return;
		const message = { customType: "scratchpad-notes", content: notes, display: false };
		// Inside the loop, or before an overflow retry, steer so the next response sees the notes.
		// Otherwise nothing follows, and a steered message would start a turn nobody asked for, so the
		// notes are appended without one: at once when idle, or when the run settles.
		pi.sendMessage(message, looping || event.willRetry ? undefined : { triggerTurn: false });
	});
}
