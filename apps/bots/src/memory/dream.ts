// Consolidation, "dream" (spec section 6): a daily pass, once enough has changed, that converts relative dates to
// absolute ones, merges duplicates, deletes contradicted notes and keeps the index short.
import type { NotesStore, StoredNote } from "./notes.ts";
import type { Helper } from "./recall.ts";

const DAY = 86_400_000;

export function createDreamTable(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS dream_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_at INTEGER NOT NULL, runs INTEGER NOT NULL)");
	sql.exec("INSERT OR IGNORE INTO dream_state (id, last_at, runs) VALUES (1, 0, 0)");
}

/** Counts a finished run toward the next consolidation. */
export function countRun(sql: SqlStorage): void {
	sql.exec("UPDATE dream_state SET runs = runs + 1 WHERE id = 1");
}

const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** "today", "yesterday" and "tomorrow" as the dates they meant when the note was written. */
export function absoluteDates(text: string, writtenAt: number): string {
	return text
		.replace(/\byesterday\b/gi, `on ${isoDay(writtenAt - DAY)}`)
		.replace(/\btomorrow\b/gi, `on ${isoDay(writtenAt + DAY)}`)
		.replace(/\btoday\b/gi, `on ${isoDay(writtenAt)}`);
}

type Plan = { delete?: string[]; merge?: { name: string; description: string; body: string; from: string[] }[] };

function parsePlan(reply: string): Plan {
	const start = reply.indexOf("{");
	const end = reply.lastIndexOf("}");
	if (start < 0 || end <= start) return {};
	try {
		return JSON.parse(reply.slice(start, end + 1)) as Plan;
	} catch {
		return {};
	}
}

export async function dream(
	bot: { sql: SqlStorage; notes: NotesStore; helper: Helper },
	options: { minHours: number; minRuns: number; now?: number },
): Promise<{ ran: boolean; deleted: string[]; merged: string[] }> {
	const now = options.now ?? Date.now();
	const state = bot.sql.exec<{ last_at: number; runs: number }>("SELECT last_at, runs FROM dream_state WHERE id = 1").one();
	if (now - state.last_at < options.minHours * 3_600_000 || state.runs < options.minRuns)
		return { ran: false, deleted: [], merged: [] };
	const deleted: string[] = [];
	const merged: string[] = [];
	// Relative dates first, so the model compares like with like.
	for (const note of bot.notes.list()) {
		const body = absoluteDates(note.body, note.updatedAt);
		if (body !== note.body) bot.notes.write({ ...note, body }, note.updatedAt);
	}
	// Exact duplicates keep the newest copy.
	const seen = new Map<string, StoredNote>();
	for (const note of bot.notes.list()) {
		const key = note.body.trim().toLowerCase();
		if (seen.has(key)) {
			bot.notes.delete(note.name);
			deleted.push(note.name);
		} else seen.set(key, note);
	}
	const notes = bot.notes.list();
	if (notes.length > 1) {
		const plan = parsePlan(
			await bot.helper(
				"You tidy a bot's notes. Merge notes that say the same thing, and delete notes a newer note contradicts. Keep " +
					'everything else. Reply with JSON: {"delete": [names], "merge": [{"name", "description", "body", "from": [names]}]}.',
				notes.map((note) => `## ${note.name} (${isoDay(note.updatedAt)}): ${note.description}\n${note.body}`).join("\n\n"),
			),
		);
		const names = new Set(notes.map((note) => note.name));
		for (const merge of plan.merge ?? []) {
			const from = (merge.from ?? []).filter((name) => names.has(name));
			if (from.length === 0 || typeof merge.name !== "string" || typeof merge.body !== "string") continue;
			const newest = Math.max(...from.map((name) => bot.notes.get(name)!.updatedAt));
			for (const name of from) if (name !== merge.name) bot.notes.delete(name);
			bot.notes.write({ name: merge.name, description: merge.description ?? merge.name, body: merge.body }, newest);
			merged.push(merge.name);
		}
		for (const name of plan.delete ?? [])
			if (names.has(name) && bot.notes.get(name)) {
				bot.notes.delete(name);
				deleted.push(name);
			}
	}
	bot.sql.exec("UPDATE dream_state SET last_at = ?, runs = 0 WHERE id = 1", now);
	return { ran: true, deleted, merged };
}
