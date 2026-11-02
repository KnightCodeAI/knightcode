// The memory the bot always sees (spec section 6): the notes index, one line per note and never its content, then the
// open work. It renders as the last prompt section, after the stable instructions, so changing memory leaves the
// provider's cached prefix intact.
import type { NotesStore } from "./notes.ts";
import type { OpenWork } from "./open-work.ts";

/** Past this many lines the index shows the newest ones and says how many more search can find. */
export const INDEX_MAX_LINES = 200;

export function memoryText(notes: NotesStore, openWork: OpenWork): string | undefined {
	const lines = notes.indexText().split("\n").filter(Boolean);
	const shown = lines.slice(0, INDEX_MAX_LINES);
	const more = lines.length - shown.length;
	const work = openWork.list().filter((item) => !item.done);
	const parts: string[] = [];
	if (shown.length > 0)
		parts.push(
			`Your notes (names and descriptions; relevant ones are recalled in full, and search finds the rest):\n${shown.join("\n")}${
				more > 0 ? `\n…and ${more} more` : ""
			}`,
		);
	if (work.length > 0) parts.push(`Open work, started and not finished:\n${work.map((item) => `- ${item.text}`).join("\n")}`);
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}
