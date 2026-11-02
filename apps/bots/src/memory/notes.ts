// A bot's notes (spec section 6): one fact per note with a name, a one-line description and a type, kept in the bot
// object's SQLite with an FTS5 index. Each write bumps the note's version, so recall can tell a corrected note from the
// copy already in the prompt.
import type { Note } from "@knightcode/bots-protocol";

export type NoteType = Note["type"];

export interface NoteInput {
	name: string;
	description: string;
	body: string;
	type?: NoteType;
	/** True for facts that do not age (a name, a birthday); search does not weight these by recency. */
	evergreen?: boolean;
	/** Written by a run that outside text started or entered. */
	outside?: boolean;
}

export interface StoredNote extends Note {
	version: number;
	evergreen: boolean;
	createdAt: number;
}

type Row = {
	name: string;
	description: string;
	type: NoteType;
	body: string;
	version: number;
	evergreen: number;
	outside: number;
	created_at: number;
	updated_at: number;
};

const toNote = (row: Row): StoredNote => ({
	name: row.name,
	description: row.description,
	type: row.type,
	body: row.body,
	version: row.version,
	evergreen: row.evergreen === 1,
	outside: row.outside === 1,
	shared: false,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

/** One line, so a description can never smuggle extra index lines in. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export class NotesStore {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec(`CREATE TABLE IF NOT EXISTS notes (
			name TEXT PRIMARY KEY,
			description TEXT NOT NULL,
			type TEXT NOT NULL,
			body TEXT NOT NULL,
			version INTEGER NOT NULL,
			evergreen INTEGER NOT NULL DEFAULT 0,
			outside INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`);
		sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(name, description, body)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS note_vectors (name TEXT PRIMARY KEY, version INTEGER NOT NULL, model TEXT NOT NULL, vector TEXT NOT NULL)",
		);
	}

	/** Creates or replaces the note named `note.name`; `at` sets its time (imports, tests). */
	write(note: NoteInput, at = Date.now()): StoredNote {
		const name = oneLine(note.name);
		if (!name) throw new Error("a note needs a name");
		const previous = this.get(name);
		this.#sql.exec(
			`INSERT INTO notes (name, description, type, body, version, evergreen, outside, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (name) DO UPDATE SET description = excluded.description, type = excluded.type, body = excluded.body,
			   version = excluded.version, evergreen = excluded.evergreen, outside = excluded.outside, updated_at = excluded.updated_at`,
			name,
			oneLine(note.description),
			note.type ?? "fact",
			note.body,
			(previous?.version ?? 0) + 1,
			note.evergreen ? 1 : 0,
			note.outside ? 1 : 0,
			previous?.createdAt ?? at,
			at,
		);
		this.#sql.exec("DELETE FROM notes_fts WHERE name = ?", name);
		this.#sql.exec("INSERT INTO notes_fts (name, description, body) VALUES (?, ?, ?)", name, oneLine(note.description), note.body);
		return this.get(name)!;
	}

	get(name: string): StoredNote | undefined {
		const row = this.#sql.exec<Row>("SELECT * FROM notes WHERE name = ?", name).toArray()[0];
		return row ? toNote(row) : undefined;
	}

	list(): StoredNote[] {
		return this.#sql.exec<Row>("SELECT * FROM notes ORDER BY updated_at DESC").toArray().map(toNote);
	}

	delete(name: string): void {
		this.#sql.exec("DELETE FROM notes WHERE name = ?", name);
		this.#sql.exec("DELETE FROM notes_fts WHERE name = ?", name);
		this.#sql.exec("DELETE FROM note_vectors WHERE name = ?", name);
	}

	/** The index the bot always sees: one line per note, name and description, never the content. */
	indexText(): string {
		return this.list()
			.map((note) => `- ${note.name}: ${note.description}`)
			.join("\n");
	}

	/** FTS5 matches for `query`'s words, best first, as note names with a bm25 score (lower is better). */
	keywordMatches(query: string, limit: number): { name: string; rank: number }[] {
		const words = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
		if (words.length === 0) return [];
		const match = [...new Set(words)].map((word) => `"${word}"`).join(" OR ");
		return this.#sql
			.exec<{ name: string; rank: number }>("SELECT name, rank FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?", match, limit)
			.toArray();
	}

	/** The stored embedding of a note's current version under `model`, if any. */
	vector(name: string, version: number, model: string): number[] | undefined {
		const row = this.#sql
			.exec<{ vector: string }>("SELECT vector FROM note_vectors WHERE name = ? AND version = ? AND model = ?", name, version, model)
			.toArray()[0];
		return row ? (JSON.parse(row.vector) as number[]) : undefined;
	}

	setVector(name: string, version: number, model: string, vector: number[]): void {
		this.#sql.exec(
			"INSERT INTO note_vectors (name, version, model, vector) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET version = excluded.version, model = excluded.model, vector = excluded.vector",
			name,
			version,
			model,
			JSON.stringify(vector),
		);
	}
}
