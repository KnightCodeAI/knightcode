// Teach a task by showing it (spec section 18): the user demonstrates a result on the bot's screen while the bot
// watches. Each step is recorded as the input event, a screenshot and the page's element snapshot. Protected input
// (passwords) is never recorded: such events are dropped before anything is stored. Stopping drafts a skill with the
// bot's model; the recording is deleted once that draft is saved or discarded.
import type { SkillDraft } from "@knightcode/bots-protocol";
import type { Helper } from "../memory/recall.ts";
import { DRAFT_FORMAT, parseDraft } from "./save-as-skill.ts";

/** One input event the user made while teaching. */
export type TeachEvent =
	| { kind: "click"; x: number; y: number; target?: string }
	| { kind: "type"; text: string; target?: string }
	| { kind: "key"; keys: string[] }
	| { kind: "navigate"; url: string }
	| { kind: "scroll"; dy: number }
	/** Typed through Protected input: never recorded. */
	| { kind: "protected-input"; target?: string };

export interface TeachStep {
	index: number;
	event: TeachEvent;
	/** PNG, base64; kept only until the draft is saved or discarded. */
	screenshot?: string;
	snapshot?: string;
	at: number;
}

const MAX_STEPS = 300;

export function createTeachingTables(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS teach_sessions (id TEXT PRIMARY KEY, goal TEXT NOT NULL, started_at INTEGER NOT NULL, stopped INTEGER NOT NULL DEFAULT 0)");
	sql.exec(
		"CREATE TABLE IF NOT EXISTS teach_steps (session_id TEXT NOT NULL, idx INTEGER NOT NULL, event TEXT NOT NULL, screenshot TEXT, snapshot TEXT, at INTEGER NOT NULL, PRIMARY KEY (session_id, idx))",
	);
}

export class Teaching {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		createTeachingTables(sql);
	}

	/** Starts recording a demonstration of `goal`; one session at a time per bot. */
	startTeaching(goal: string): { sessionId: string } {
		if (!goal.trim()) throw new Error("Say what result you will show.");
		this.#sql.exec("DELETE FROM teach_steps WHERE session_id IN (SELECT id FROM teach_sessions WHERE stopped = 0)");
		this.#sql.exec("DELETE FROM teach_sessions WHERE stopped = 0");
		const sessionId = `teach_${crypto.randomUUID()}`;
		this.#sql.exec("INSERT INTO teach_sessions (id, goal, started_at) VALUES (?, ?, ?)", sessionId, goal.trim().slice(0, 500), Date.now());
		return { sessionId };
	}

	#active(sessionId: string) {
		const row = this.#sql
			.exec<{ id: string; goal: string; stopped: number }>("SELECT * FROM teach_sessions WHERE id = ?", sessionId)
			.toArray()[0];
		if (!row) throw new Error("No such teaching session.");
		return row;
	}

	/** Records one step. Protected input is dropped here and never stored. */
	recordStep(sessionId: string, event: TeachEvent, screenshot?: string, snapshot?: string): boolean {
		const session = this.#active(sessionId);
		if (session.stopped) throw new Error("This teaching session has stopped.");
		if (event.kind === "protected-input") return false;
		const count = this.#sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM teach_steps WHERE session_id = ?", sessionId).one().n;
		if (count >= MAX_STEPS) return false;
		this.#sql.exec(
			"INSERT INTO teach_steps (session_id, idx, event, screenshot, snapshot, at) VALUES (?, ?, ?, ?, ?, ?)",
			sessionId,
			count,
			JSON.stringify(event),
			screenshot ?? null,
			snapshot?.slice(0, 20_000) ?? null,
			Date.now(),
		);
		return true;
	}

	steps(sessionId: string): TeachStep[] {
		return this.#sql
			.exec<{ idx: number; event: string; screenshot: string | null; snapshot: string | null; at: number }>(
				"SELECT * FROM teach_steps WHERE session_id = ? ORDER BY idx",
				sessionId,
			)
			.toArray()
			.map((row) => ({
				index: row.idx,
				event: JSON.parse(row.event) as TeachEvent,
				...(row.screenshot ? { screenshot: row.screenshot } : {}),
				...(row.snapshot ? { snapshot: row.snapshot } : {}),
				at: row.at,
			}));
	}

	/** Stops recording and drafts the skill from the demonstrated steps; the recording stays until save or discard. */
	async stopTeaching(sessionId: string, helper: Helper): Promise<SkillDraft> {
		const session = this.#active(sessionId);
		this.#sql.exec("UPDATE teach_sessions SET stopped = 1 WHERE id = ?", sessionId);
		const steps = this.steps(sessionId);
		const reply = await helper(
			`The owner demonstrated a task so you can do it yourself later. Write a skill from the steps: the general steps, ` +
				`when to use it, what to check, and when to ask first. ${DRAFT_FORMAT}`,
			`Result shown: ${session.goal}\n\nSteps:\n${steps.map(describeStep).join("\n")}`,
		);
		return parseDraft(reply, session.goal.slice(0, 80));
	}

	/** Deletes the recording: after the draft is saved or discarded, or when the user cancels. */
	discard(sessionId: string): void {
		this.#sql.exec("DELETE FROM teach_steps WHERE session_id = ?", sessionId);
		this.#sql.exec("DELETE FROM teach_sessions WHERE id = ?", sessionId);
	}
}

/** A step as the drafting model reads it: the event and the page around it, never a screenshot's pixels. */
export function describeStep(step: TeachStep): string {
	const event = step.event;
	const what =
		event.kind === "click"
			? `click${event.target ? ` "${event.target}"` : ` at ${event.x},${event.y}`}`
			: event.kind === "type"
				? `type "${event.text}"${event.target ? ` into "${event.target}"` : ""}`
				: event.kind === "key"
					? `press ${event.keys.join("+")}`
					: event.kind === "navigate"
						? `open ${event.url}`
						: event.kind === "scroll"
							? `scroll ${event.dy > 0 ? "down" : "up"}`
							: "protected input";
	const page = step.snapshot ? `\n   page: ${step.snapshot.split("\n").slice(0, 15).join(" | ").slice(0, 600)}` : "";
	return `${step.index + 1}. ${what}${page}`;
}
