// Import (spec section 6): a prompt the user pastes into another assistant, and the answer turned into notes.
import { NOTE_FORMAT, parseNotes } from "./extract.ts";
import type { NotesStore } from "./notes.ts";
import type { Helper } from "./recall.ts";

/** What the user copies into their other assistant. */
export const IMPORT_PROMPT =
	"List everything you remember about me that would help a new assistant work with me: my name, work, projects, " +
	"preferences, writing style, important people and dates, and decisions I have made. One fact per line, with dates " +
	"written out in full. Leave out passwords, account numbers and anything I asked you to keep private.";

/** Turns the other assistant's answer into notes; returns their names. */
export async function importNotes(input: { notes: NotesStore; helper: Helper; answer: string; now?: number }): Promise<string[]> {
	if (!input.answer.trim()) return [];
	const reply = await input.helper(
		`Turn this list of facts about a person into notes, one fact each. ${NOTE_FORMAT}`,
		input.answer.slice(0, 50_000),
	);
	const saved: string[] = [];
	for (const note of parseNotes(reply)) saved.push((await input.notes.write(note, input.now)).name);
	return saved;
}
