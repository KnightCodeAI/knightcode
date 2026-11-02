// Recall (spec section 6): before each turn, up to 5 notes relevant to the new message join the transcript as a recall
// entry. A note is skipped only while its current version is in the active context, so one that compaction dropped, or
// that was corrected since, is eligible again. The helper model call is skipped when every candidate fits anyway or
// there is no candidate, since it costs the user tokens every turn.
import type { Models } from "@knightcode/ai";
import type { ModelRef } from "@knightcode/bots-protocol";
import type { ContextView } from "@knightcode/durable";
import type { StoredNote } from "./notes.ts";
import type { NoteHit } from "./search.ts";

/** A one-shot call to the user's memory helper model: system and user text in, text out. */
export type Helper = (system: string, user: string) => Promise<string>;

/** The helper on the model the user chose for memory work. */
export function modelHelper(models: Models, ref: ModelRef): Helper {
	return async (system, user) => {
		const model = models.getModel(ref.provider, ref.modelId);
		if (!model) throw new Error("the memory model is unavailable");
		const reply = await models.completeSimple(model, {
			systemPrompt: system,
			messages: [{ role: "user", content: user, timestamp: Date.now() }],
		});
		if (reply.stopReason === "error") throw new Error(reply.errorMessage ?? "the memory model failed");
		return reply.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("");
	};
}

export const RECALL_LIMIT = 5;
/** The transcript entry recall writes: the notes' text for the model, and which versions it holds. */
export const RECALL_ENTRY = "bots.recall";
export type RecallData = { notes: { name: string; version: number }[] };

const key = (name: string, version: number) => `${name}@${version}`;

/** The note versions recall entries hold in the active context (what the next request sends). */
export function notesInPrompt(view: ContextView): Set<string> {
	const held = new Set<string>();
	for (const entry of view.entries) {
		if (entry.kind !== RECALL_ENTRY) continue;
		for (const note of (entry.data as RecallData | undefined)?.notes ?? []) held.add(key(note.name, note.version));
	}
	return held;
}

export async function selectRecall(input: {
	message: string;
	candidates: NoteHit[];
	inPrompt: Set<string>;
	helper?: Helper;
}): Promise<string[]> {
	const candidates = input.candidates.filter((hit) => !input.inPrompt.has(key(hit.name, hit.version)));
	if (candidates.length === 0) return [];
	if (candidates.length <= RECALL_LIMIT || !input.helper) return candidates.slice(0, RECALL_LIMIT).map((hit) => hit.name);
	try {
		const reply = await input.helper(
			"Pick the notes that would help answer the user's new message. Reply with their names, one per line, at most " +
				`${RECALL_LIMIT}, best first, or NONE.`,
			`Message:\n${input.message}\n\nNotes:\n${candidates.map((hit) => `- ${hit.name}: ${hit.description}`).join("\n")}`,
		);
		const names = new Set(candidates.map((hit) => hit.name));
		return [
			...new Set(
				reply
					.split("\n")
					.map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
					.filter((name) => names.has(name)),
			),
		].slice(0, RECALL_LIMIT);
	} catch {
		// The helper failed: the best-scored candidates still help.
		return candidates.slice(0, RECALL_LIMIT).map((hit) => hit.name);
	}
}

const DAY = 86_400_000;

/** "47 days ago" for notes older than a day, with a reminder to verify them; nothing for newer ones. */
export function ageLabel(updatedAt: number, now = Date.now()): string | undefined {
	const age = now - updatedAt;
	if (age <= DAY) return undefined;
	const days = Math.floor(age / DAY);
	return `${days} ${days === 1 ? "day" : "days"} ago; verify before relying on it`;
}

/** The recalled notes as the model reads them. */
export function renderRecalled(notes: StoredNote[], now = Date.now()): string {
	const blocks = notes.map((note) => {
		const age = ageLabel(note.updatedAt, now);
		const outside = note.outside ? "; written while reading outside text" : "";
		return `## ${note.name} (${note.type}${age ? `, ${age}` : ""}${outside})\n${note.body}`;
	});
	return `<recalled-notes>\n${blocks.join("\n\n")}\n</recalled-notes>`;
}
