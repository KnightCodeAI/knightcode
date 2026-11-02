// Routines (spec section 12): a prompt on a bot plus triggers, any of which fires it, with a standing grant for what it
// may do when outside text starts it (section 24). Stored in the bot object with their run history; their routing keys
// are indexed in D1 so inbound events find them. Schedules are run by the bot's alarm; missed firings become one
// catch-up run that is told it is late. One-off reminders are schedules that fire once.
import type { Grant, ModelRef, Routine, Trigger } from "@knightcode/bots-protocol";
import { type HostWrite, immediateWrite } from "../bot/host-sql.ts";
import { nextFire } from "./schedule.ts";

let clock: () => number = () => Date.now();
/** Tests only: the routines' clock (`undefined` restores the real one). */
export function setRoutineClock(next: (() => number) | undefined): void {
	clock = next ?? (() => Date.now());
}
export const routineNow = () => clock();

export interface RoutineInput {
	name: string;
	prompt: string;
	triggers: Trigger[];
	grant: Grant;
	active?: boolean;
	model?: ModelRef;
}

export interface RoutineRun {
	id: string;
	routineId: string;
	firedAt: number;
	title: string;
	startedBy: "routine" | "email" | "webhook" | "channel";
	lateMs: number;
}

type Row = {
	id: string;
	name: string;
	prompt: string;
	triggers: string;
	grant_json: string;
	active: number;
	model: string | null;
	next_at: number | null;
	last_run_at: number | null;
};

const toRoutine = (botId: string, row: Row): Routine => ({
	id: row.id,
	botId,
	name: row.name,
	prompt: row.prompt,
	triggers: JSON.parse(row.triggers) as Trigger[],
	grant: JSON.parse(row.grant_json) as Grant,
	active: row.active === 1,
	...(row.model ? { model: JSON.parse(row.model) as ModelRef } : {}),
	...(row.next_at ? { nextRunAt: row.next_at } : {}),
	...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
});

/** The next time any schedule trigger of `triggers` fires after `after`, or undefined. */
export function nextScheduledAt(triggers: Trigger[], after: number): number | undefined {
	const times = triggers.flatMap((trigger) => {
		if (trigger.kind !== "schedule") return [];
		if (trigger.cron) {
			const next = nextFire(trigger.cron, trigger.timeZone, after);
			return next === undefined ? [] : [next];
		}
		return trigger.at !== undefined && trigger.at > after ? [trigger.at] : [];
	});
	return times.length ? Math.min(...times) : undefined;
}

/** A reminder: only one-off schedule triggers, so the routine ends after its run. */
export const isReminder = (triggers: Trigger[]) => triggers.length > 0 && triggers.every((t) => t.kind === "schedule" && !t.cron && t.at !== undefined);

export class RoutineStore {
	readonly #sql: SqlStorage;
	readonly #write: HostWrite;
	readonly #botId: string;

	constructor(sql: SqlStorage, botId: string, write: HostWrite = immediateWrite(sql)) {
		this.#sql = sql;
		this.#write = write;
		this.#botId = botId;
		sql.exec(`CREATE TABLE IF NOT EXISTS routines (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			prompt TEXT NOT NULL,
			triggers TEXT NOT NULL,
			grant_json TEXT NOT NULL,
			active INTEGER NOT NULL,
			model TEXT,
			next_at INTEGER,
			last_run_at INTEGER,
			created_at INTEGER NOT NULL
		)`);
		sql.exec(`CREATE TABLE IF NOT EXISTS routine_runs (
			id TEXT PRIMARY KEY,
			routine_id TEXT NOT NULL,
			fired_at INTEGER NOT NULL,
			title TEXT NOT NULL,
			started_by TEXT NOT NULL,
			late_ms INTEGER NOT NULL
		)`);
	}

	get(id: string): Routine | undefined {
		const row = this.#sql.exec<Row>("SELECT * FROM routines WHERE id = ?", id).toArray()[0];
		return row ? toRoutine(this.#botId, row) : undefined;
	}

	list(): Routine[] {
		return this.#sql.exec<Row>("SELECT * FROM routines ORDER BY created_at").toArray().map((row) => toRoutine(this.#botId, row));
	}

	async create(input: RoutineInput): Promise<Routine> {
		const id = `rt_${crypto.randomUUID()}`;
		const nextAt = nextScheduledAt(input.triggers, routineNow()) ?? null;
		await this.#write((sql) =>
			sql.exec(
				"INSERT INTO routines (id, name, prompt, triggers, grant_json, active, model, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				id,
				input.name.trim().slice(0, 120) || "Routine",
				input.prompt.slice(0, 20_000),
				JSON.stringify(input.triggers),
				JSON.stringify(input.grant),
				input.active === false ? 0 : 1,
				input.model ? JSON.stringify(input.model) : null,
				nextAt,
				routineNow(),
			),
		);
		return this.get(id)!;
	}

	async update(id: string, patch: Partial<RoutineInput>): Promise<Routine> {
		const current = this.get(id);
		if (!current) throw new Error("no such routine");
		const next = { ...current, ...patch };
		await this.#write((sql) =>
			sql.exec(
				"UPDATE routines SET name = ?, prompt = ?, triggers = ?, grant_json = ?, active = ?, model = ?, next_at = ? WHERE id = ?",
				next.name,
				next.prompt,
				JSON.stringify(next.triggers),
				JSON.stringify(next.grant),
				next.active ? 1 : 0,
				next.model ? JSON.stringify(next.model) : null,
				nextScheduledAt(next.triggers, routineNow()) ?? null,
				id,
			),
		);
		return this.get(id)!;
	}

	delete(id: string): Promise<void> {
		return this.#write((sql) => {
			sql.exec("DELETE FROM routines WHERE id = ?", id);
			sql.exec("DELETE FROM routine_runs WHERE routine_id = ?", id);
		});
	}

	/** The earliest schedule deadline of an active routine, for the bot's alarm. */
	nextDeadline(): number | undefined {
		const row = this.#sql.exec<{ at: number | null }>("SELECT MIN(next_at) AS at FROM routines WHERE active = 1 AND next_at IS NOT NULL").one();
		return row.at ?? undefined;
	}

	/** Active routines whose schedule is due. */
	due(now: number): Routine[] {
		return this.#sql
			.exec<Row>("SELECT * FROM routines WHERE active = 1 AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at", now)
			.toArray()
			.map((row) => toRoutine(this.#botId, row));
	}

	/**
	 * Records a firing and moves the schedule past `now`: every missed firing is covered by this one run. A reminder
	 * turns itself off after its run.
	 */
	/** Whether `routineId` started fewer than `perMinute` runs in the minute before `now`. */
	underRate(routineId: string, now: number, perMinute: number): boolean {
		return (
			this.#sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM routine_runs WHERE routine_id = ? AND fired_at > ?", routineId, now - 60_000).one().n <
			perMinute
		);
	}

	async recordRun(routine: Routine, run: Omit<RoutineRun, "id" | "routineId">): Promise<RoutineRun> {
		const id = `run_${crypto.randomUUID()}`;
		const now = routineNow();
		await this.#write((sql) => {
			sql.exec(
				"INSERT INTO routine_runs (id, routine_id, fired_at, title, started_by, late_ms) VALUES (?, ?, ?, ?, ?, ?)",
				id,
				routine.id,
				run.firedAt,
				run.title.slice(0, 200),
				run.startedBy,
				run.lateMs,
			);
			sql.exec(
				"UPDATE routines SET last_run_at = ?, next_at = ?, active = ? WHERE id = ?",
				run.firedAt,
				nextScheduledAt(routine.triggers, now) ?? null,
				isReminder(routine.triggers) && run.startedBy === "routine" ? 0 : routine.active ? 1 : 0,
				routine.id,
			);
		});
		return { id, routineId: routine.id, ...run };
	}

	runs(routineId: string): RoutineRun[] {
		return this.#sql
			.exec<{ id: string; routine_id: string; fired_at: number; title: string; started_by: RoutineRun["startedBy"]; late_ms: number }>(
				"SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY fired_at DESC",
				routineId,
			)
			.toArray()
			.map((row) => ({ id: row.id, routineId: row.routine_id, firedAt: row.fired_at, title: row.title, startedBy: row.started_by, lateMs: row.late_ms }));
	}
}

/** The D1 routing keys of a routine's event triggers (schedules and watches are the bot's own alarm). */
export async function routeKeys(
	db: D1Database,
	routine: Routine,
	accountId: string,
	botAddress: string | undefined,
): Promise<{ kind: Trigger["kind"]; key: string }[]> {
	const keys: { kind: Trigger["kind"]; key: string }[] = [];
	for (const trigger of routine.triggers) {
		if (trigger.kind === "github") keys.push({ kind: "github", key: trigger.repo.toLowerCase() });
		else if (trigger.kind === "email" && botAddress) keys.push({ kind: "email", key: botAddress.toLowerCase() });
		else if (trigger.kind === "composio") keys.push({ kind: "composio", key: `${accountId}:${trigger.appId.toLowerCase()}` });
		else if (trigger.kind === "slack") {
			const teams = await db.prepare("SELECT team_id FROM slack_teams WHERE account_id = ?").bind(accountId).all<{ team_id: string }>();
			for (const team of teams.results) keys.push({ kind: "slack", key: team.team_id });
		}
	}
	return keys;
}

/** Replaces a routine's routing rows (webhooks keep theirs: they hold the minted secret). */
export async function indexRoutine(
	db: D1Database,
	input: { routine: Routine; botId: string; accountId: string; botAddress?: string },
): Promise<void> {
	const keys = input.routine.active ? await routeKeys(db, input.routine, input.accountId, input.botAddress) : [];
	await db.batch([
		db.prepare("DELETE FROM routine_triggers WHERE routine_id = ? AND kind != 'webhook'").bind(input.routine.id),
		...keys.map((key) =>
			db
				.prepare("INSERT OR IGNORE INTO routine_triggers (routine_id, bot_id, account_id, kind, route_key) VALUES (?, ?, ?, ?, ?)")
				.bind(input.routine.id, input.botId, input.accountId, key.kind, key.key),
		),
	]);
}
