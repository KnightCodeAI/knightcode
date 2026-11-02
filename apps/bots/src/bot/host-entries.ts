// Entries the host writes into a bot's thread beside the model's transcript (spec section 6): cards (an approval, a
// question, a takeover request, a settings change another bot made, a skill draft, a secret request, a suggestion, a
// helper's progress), "Messaged <bot>" rows, and events. The live view merges them with the transcript by time; a card
// that changes (answered, undone, saved) changes in place.
import type { Card, Entry } from "@knightcode/bots-protocol";
import type { HostWrite } from "./host-sql.ts";

export function createHostEntriesTable(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS host_entries (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, entry TEXT NOT NULL)");
}

export function hostEntries(sql: SqlStorage): Entry[] {
	return sql
		.exec<{ entry: string }>("SELECT entry FROM host_entries ORDER BY created_at, id")
		.toArray()
		.map((row) => JSON.parse(row.entry) as Entry);
}

export function hostEntry(sql: SqlStorage, id: string): Entry | undefined {
	const row = sql.exec<{ entry: string }>("SELECT entry FROM host_entries WHERE id = ?", id).toArray()[0];
	return row ? (JSON.parse(row.entry) as Entry) : undefined;
}

/** Adds one entry (its own id and time); returns it. */
export async function addHostEntry<E extends Entry>(write: HostWrite, entry: E): Promise<E> {
	await write((sql) => void sql.exec("INSERT OR REPLACE INTO host_entries (id, created_at, entry) VALUES (?, ?, ?)", entry.id, entry.createdAt, JSON.stringify(entry)));
	return entry;
}

/** Adds a card entry now. */
export function addCard(write: HostWrite, card: Card, at = Date.now(), id = `card-${crypto.randomUUID()}`): Promise<Entry> {
	return addHostEntry(write, { kind: "card", id, createdAt: at, card });
}

/** Changes one card in place; nothing when it is not a card. Returns the changed card. */
export async function patchCard(write: HostWrite, sql: SqlStorage, id: string, change: (card: Card) => Card): Promise<Card | undefined> {
	const entry = hostEntry(sql, id);
	if (entry?.kind !== "card") return undefined;
	const card = change(entry.card);
	await write((target) => void target.exec("UPDATE host_entries SET entry = ? WHERE id = ?", JSON.stringify({ ...entry, card }), id));
	return card;
}

/** The first card matching `test`, with its entry id. */
export function findCard(sql: SqlStorage, test: (card: Card) => boolean): { id: string; card: Card } | undefined {
	for (const entry of hostEntries(sql)) if (entry.kind === "card" && test(entry.card)) return { id: entry.id, card: entry.card };
	return undefined;
}
