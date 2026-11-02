// Small account documents the user object keeps as JSON, for state no richer store owns: the sidebar's sections and
// per-bot flags, onboarding, approval settings, home routing and the like. Each document is read whole and written
// whole; none grows without bound.

export function createDocsTable(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
}

export function readDoc<T>(sql: SqlStorage, key: string, fallback: () => T): T {
	const row = sql.exec<{ value: string }>("SELECT value FROM docs WHERE key = ?", key).toArray()[0];
	return row ? (JSON.parse(row.value) as T) : fallback();
}

export function writeDoc<T>(sql: SqlStorage, key: string, value: T): T {
	sql.exec("INSERT OR REPLACE INTO docs (key, value) VALUES (?, ?)", key, JSON.stringify(value));
	return value;
}

/** Reads, changes and writes one document in a single step (the object is single-threaded between awaits). */
export function updateDoc<T>(sql: SqlStorage, key: string, fallback: () => T, change: (value: T) => T | void): T {
	const current = readDoc(sql, key, fallback);
	const next = change(current) ?? current;
	return writeDoc(sql, key, next);
}
