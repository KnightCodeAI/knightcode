// The usage page's data (spec section 16): runs, tokens and model cost per bot, per routine and per model, from the
// providers' usage reports, even when the user pays the provider directly.

export interface UsageDelta {
	botId: string;
	routineId?: string;
	model: string;
	input: number;
	output: number;
	/** Dollars, as the provider catalog prices it. */
	cost: number;
}

export function createUsageTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS usage (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		bot_id TEXT NOT NULL,
		routine_id TEXT,
		model TEXT NOT NULL,
		input INTEGER NOT NULL,
		output INTEGER NOT NULL,
		cost REAL NOT NULL,
		at INTEGER NOT NULL
	)`);
}

export function recordUsage(sql: SqlStorage, deltas: UsageDelta[], now = Date.now()): void {
	for (const delta of deltas)
		sql.exec(
			"INSERT INTO usage (bot_id, routine_id, model, input, output, cost, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			delta.botId,
			delta.routineId ?? null,
			delta.model,
			delta.input,
			delta.output,
			delta.cost,
			now,
		);
}

export type UsageRow = { key: string; runs: number; input: number; output: number; cost: number };

/** Totals since `since`, grouped by bot, by routine (routine runs only) and by model. */
export function usageSummary(sql: SqlStorage, since = 0): { byBot: UsageRow[]; byRoutine: UsageRow[]; byModel: UsageRow[] } {
	const group = (column: "bot_id" | "routine_id" | "model") =>
		sql
			.exec<UsageRow>(
				`SELECT ${column} AS key, COUNT(*) AS runs, SUM(input) AS input, SUM(output) AS output, SUM(cost) AS cost FROM usage WHERE at >= ? AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY cost DESC`,
				since,
			)
			.toArray();
	return { byBot: group("bot_id"), byRoutine: group("routine_id"), byModel: group("model") };
}

type Reported = { provider?: string; model?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } };

/** One run's spend per model, from its assistant messages' provider usage reports. */
export function usageByModel(messages: Reported[]): { model: string; input: number; output: number; cost: number }[] {
	const totals = new Map<string, { model: string; input: number; output: number; cost: number }>();
	for (const message of messages) {
		if (!message.usage || !message.model) continue;
		const model = `${message.provider ?? "unknown"}/${message.model}`;
		const total = totals.get(model) ?? { model, input: 0, output: 0, cost: 0 };
		total.input += message.usage.input ?? 0;
		total.output += message.usage.output ?? 0;
		total.cost += message.usage.cost?.total ?? 0;
		totals.set(model, total);
	}
	return [...totals.values()];
}
