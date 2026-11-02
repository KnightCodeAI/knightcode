// Suggestions (spec section 20): a bot may propose work it noticed, as a card in its chat and the inbox. Off per bot
// until the user turns it on, at most a few a day per bot, never acting on its own. Accepting starts a user-started run;
// dismissing teaches the bot to suggest less of that kind.

export const SUGGESTIONS_PER_DAY = 3;
/** Each dismissal of a kind halves how often that kind may come back, down to one a week. */
const DISMISS_FACTOR = 2;

export function createSuggestionTables(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS suggestions_made (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, at INTEGER NOT NULL)");
	sql.exec("CREATE TABLE IF NOT EXISTS suggestions_dismissed (kind TEXT PRIMARY KEY, count INTEGER NOT NULL, last_at INTEGER NOT NULL)");
}

const DAY = 86_400_000;

/** Whether the bot may suggest `kind` now: enabled, under the daily cap, and not too soon after dismissals of it. */
export function maySuggest(sql: SqlStorage, input: { enabled: boolean; kind: string; now?: number }): { ok: true } | { ok: false; reason: string } {
	const now = input.now ?? Date.now();
	if (!input.enabled) return { ok: false, reason: "Suggestions are off for this bot." };
	const today = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM suggestions_made WHERE at > ?", now - DAY).one().n;
	if (today >= SUGGESTIONS_PER_DAY) return { ok: false, reason: `At most ${SUGGESTIONS_PER_DAY} suggestions a day.` };
	const dismissed = sql.exec<{ count: number; last_at: number }>("SELECT count, last_at FROM suggestions_dismissed WHERE kind = ?", input.kind).toArray()[0];
	if (dismissed) {
		const wait = Math.min(7 * DAY, DAY * DISMISS_FACTOR ** (dismissed.count - 1));
		if (now - dismissed.last_at < wait) return { ok: false, reason: "The owner dismissed this kind of suggestion recently." };
	}
	return { ok: true };
}

export function recordSuggestion(sql: SqlStorage, input: { kind: string; title: string; now?: number }): string {
	const id = `sug_${crypto.randomUUID()}`;
	sql.exec("INSERT INTO suggestions_made (id, kind, title, at) VALUES (?, ?, ?, ?)", id, input.kind, input.title, input.now ?? Date.now());
	return id;
}

export function recordDismissal(sql: SqlStorage, kind: string, now = Date.now()): void {
	sql.exec(
		"INSERT INTO suggestions_dismissed (kind, count, last_at) VALUES (?, 1, ?) ON CONFLICT (kind) DO UPDATE SET count = count + 1, last_at = excluded.last_at",
		kind,
		now,
	);
}
