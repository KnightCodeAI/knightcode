// Extraction (spec section 6): after a run, a background pass saves what the run learned as notes. Skipped when the run
// already wrote notes itself. Notes from a run outside text started or entered are marked so.
import type { NoteInput, NotesStore } from "./notes.ts";
import type { Helper } from "./recall.ts";

const TYPES = new Set(["fact", "preference", "decision", "reference"]);

/** The notes in a helper's JSON answer (an array of {name, description, body, type?}), ignoring anything malformed. */
export function parseNotes(reply: string): NoteInput[] {
	const start = reply.indexOf("[");
	const end = reply.lastIndexOf("]");
	if (start < 0 || end <= start) return [];
	let value: unknown;
	try {
		value = JSON.parse(reply.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const { name, description, body, type } = item as Record<string, unknown>;
		if (typeof name !== "string" || typeof description !== "string" || typeof body !== "string" || !name.trim()) return [];
		return [{ name: name.trim(), description, body, type: TYPES.has(type as string) ? (type as NoteInput["type"]) : "fact" }];
	});
}

export const NOTE_FORMAT =
	'Reply with a JSON array of notes, one fact each: [{"name": "short-kebab-name", "description": "one line", ' +
	'"body": "the fact, with absolute dates", "type": "fact|preference|decision|reference"}]. Reply [] when there is nothing.';

export async function extractAfterRun(run: {
	notes: NotesStore;
	helper: Helper;
	/** The run's messages as plain text. */
	transcript: string;
	/** True when the run saved notes itself. */
	wroteNotes: boolean;
	outside: boolean;
	now?: number;
}): Promise<string[]> {
	if (run.wroteNotes || !run.transcript.trim()) return [];
	const existing = run.notes.indexText();
	const reply = await run.helper(
		`You keep a bot's long-term notes about its owner and their work. Save only durable facts, preferences and decisions ` +
			`from this conversation that a later conversation would need; skip chit-chat and anything already noted. Today is ` +
			`${new Date(run.now ?? Date.now()).toISOString().slice(0, 10)}. Reuse an existing name to correct a note. ${NOTE_FORMAT}`,
		`Existing notes:\n${existing || "(none)"}\n\nConversation:\n${run.transcript}`,
	);
	return parseNotes(reply).map((note) => run.notes.write({ ...note, outside: run.outside }, run.now).name);
}
