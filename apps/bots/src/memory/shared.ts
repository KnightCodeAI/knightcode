// Shared memory (spec section 6): facts every bot of the user reads, kept in the user object. "Share with all my bots"
// copies selected notes there; a privacy check keeps notes that look private where they were and says how many, and a
// note written by an outside-marked run needs the user's approval first (spec section 24).
import type { NotesStore, StoredNote } from "./notes.ts";

/** The user object's shared notes. */
export interface SharedNotes {
	put(note: { name: string; description: string; body: string; type: StoredNote["type"] }): Promise<void>;
}

const PRIVATE = [
	/[\w.+-]+@[\w-]+\.[\w.]+/, // email address
	/\+?\d[\d\s().-]{8,}\d/, // phone or account number
	/\b\d{3}-\d{2}-\d{4}\b/, // national id
	/\b(?:\d[ -]?){13,19}\b/, // card number
	/\b(password|passcode|pin|secret|token|api key|private key|ssn|passport)\b/i,
	/\b(diagnos\w*|prescri\w*|therapy|medication|pregnan\w*|illness|salary|debt|bank account)\b/i,
	/\b\d+\s+\w+\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr)\b/i, // street address
];

/** Whether a note looks private enough to keep with its bot. */
export const looksPrivate = (note: StoredNote) => PRIVATE.some((pattern) => pattern.test(`${note.description}\n${note.body}`));

export async function shareNotes(input: {
	notes: NotesStore;
	names: string[];
	shared: SharedNotes;
	/** The user approved sharing notes that outside-marked runs wrote. */
	approvedOutside?: boolean;
}): Promise<{ shared: string[]; keptBack: number; needsApproval: string[] }> {
	const result = { shared: [] as string[], keptBack: 0, needsApproval: [] as string[] };
	for (const name of input.names) {
		const note = input.notes.get(name);
		if (!note) continue;
		if (looksPrivate(note)) {
			result.keptBack++;
			continue;
		}
		if (note.outside && !input.approvedOutside) {
			result.needsApproval.push(name);
			continue;
		}
		await input.shared.put({ name: note.name, description: note.description, body: note.body, type: note.type });
		result.shared.push(name);
	}
	return result;
}
