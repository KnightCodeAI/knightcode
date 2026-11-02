// The append-only billing journal in D1 (spec section 16). A change is recorded in the user object's own outbox in the
// same step as the change itself, then copied to D1; each entry's key is unique there, so retrying a copy, or a
// replayed webhook, never adds an entry twice. Balances are projections of the journal.

export interface JournalEntry {
	/** Unique per change: "settle:<reservation>", "grant:<payment>". */
	key: string;
	kind: "reserve" | "settle" | "grant" | "limit";
	cents: number;
	ref: string;
}

export function createOutboxTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS journal_outbox (
		key TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		cents INTEGER NOT NULL,
		ref TEXT NOT NULL,
		at INTEGER NOT NULL
	)`);
}

/** Records `entry` in the outbox; `flushJournal` copies it to D1. */
export function recordJournal(sql: SqlStorage, entry: JournalEntry): void {
	sql.exec(
		"INSERT OR IGNORE INTO journal_outbox (key, kind, cents, ref, at) VALUES (?, ?, ?, ?, ?)",
		entry.key,
		entry.kind,
		entry.cents,
		entry.ref,
		Date.now(),
	);
}

/** Copies the outbox to D1 and empties it; what fails to copy stays for the next flush. */
export async function flushJournal(sql: SqlStorage, db: D1Database, accountId: string): Promise<void> {
	const pending = sql
		.exec<{ key: string; kind: string; cents: number; ref: string; at: number }>(
			"SELECT key, kind, cents, ref, at FROM journal_outbox ORDER BY at",
		)
		.toArray();
	if (pending.length === 0) return;
	await db.batch(
		pending.map((entry) =>
			db
				.prepare(
					"INSERT INTO billing_journal (account_id, entry_key, kind, cents, ref, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
						"ON CONFLICT (account_id, entry_key) DO NOTHING",
				)
				.bind(accountId, entry.key, entry.kind, entry.cents, entry.ref, entry.at),
		),
	);
	for (const entry of pending) sql.exec("DELETE FROM journal_outbox WHERE key = ?", entry.key);
}
