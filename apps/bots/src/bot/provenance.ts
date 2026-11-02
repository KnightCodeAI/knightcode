// Input provenance (spec sections 13 and 24): whether outside text (email, webhooks, other people's channel messages,
// web pages, other bots) started or entered a run. The mark is stored, and passes to every run that continues the work:
// steers, helpers, bot messages, retries and continuation runs.

export type OutsideSource = "email" | "webhook" | "channel" | "web" | "bot";

export function createProvenanceTable(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS provenance (run_id TEXT PRIMARY KEY, source TEXT NOT NULL, marked_at INTEGER NOT NULL)");
}

/** Marks `runId` as started or entered by outside text. The first mark's source stays. */
export function markOutside(sql: SqlStorage, runId: string, source: OutsideSource): void {
	sql.exec("INSERT OR IGNORE INTO provenance (run_id, source, marked_at) VALUES (?, ?, ?)", runId, source, Date.now());
}

export function isOutside(sql: SqlStorage, runId: string): boolean {
	return sql.exec("SELECT 1 FROM provenance WHERE run_id = ?", runId).toArray().length > 0;
}

/** `childRunId` continues `parentRunId`'s work (a steer, helper, bot message, retry or continuation): it keeps the mark. */
export function inherit(sql: SqlStorage, parentRunId: string, childRunId: string): void {
	const row = sql.exec<{ source: OutsideSource }>("SELECT source FROM provenance WHERE run_id = ?", parentRunId).toArray()[0];
	if (row) markOutside(sql, childRunId, row.source);
}
