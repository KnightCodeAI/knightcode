// Credits, reservations and the spending limit (spec section 16). The user object holds the authoritative balance.
// Billable work reserves before it starts and settles idempotently, releasing what it did not use, so the spending
// limit holds within one increment. Every change is also journaled (journal.ts).
import type { JournalEntry } from "./journal.ts";

export type MeteredKind = "computer" | "composio" | "bank";

/**
 * Cents per unit at measured cost x 1.1: a computer unit is a 5-minute block of awake time, a Composio unit one call
 * past the plan's allowance, a bank unit one linked account for a month. Dated placeholders until the beta measures
 * real cost (spec section 16: "a dated cost table the beta fills in").
 */
export const COST_TABLE = { dated: "2026-11-02", computer: 2, composio: 1, bank: 50 } as const;

export const unitCost = (kind: MeteredKind): number => COST_TABLE[kind];

export interface Reservation {
	id: string;
	kind: MeteredKind;
	units: number;
	cents: number;
	createdAt: number;
}

export interface Balance {
	/** Credits held, in cents, including what open reservations hold. */
	credits: number;
	/** Held by open reservations. */
	reserved: number;
	/** Spent this calendar month (UTC), in cents. */
	spent: number;
	/** The user's monthly spending limit in cents, or null for none. */
	limit: number | null;
}

const month = (at = Date.now()) => new Date(at).toISOString().slice(0, 7);

export function createBalanceTables(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS balance (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		credits INTEGER NOT NULL,
		spent INTEGER NOT NULL,
		month TEXT NOT NULL,
		spend_limit INTEGER
	)`);
	sql.exec("INSERT OR IGNORE INTO balance (id, credits, spent, month, spend_limit) VALUES (1, 0, 0, ?, NULL)", month());
	sql.exec(`CREATE TABLE IF NOT EXISTS reservations (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		units INTEGER NOT NULL,
		cents INTEGER NOT NULL,
		state TEXT NOT NULL,
		used INTEGER,
		created_at INTEGER NOT NULL
	)`);
	sql.exec("CREATE TABLE IF NOT EXISTS grants (key TEXT PRIMARY KEY, cents INTEGER NOT NULL, at INTEGER NOT NULL)");
}

type State = { credits: number; spent: number; month: string; spend_limit: number | null };

function state(sql: SqlStorage): State {
	const current = sql.exec<State>("SELECT credits, spent, month, spend_limit FROM balance WHERE id = 1").one();
	// A new month starts spending from zero.
	if (current.month !== month()) {
		sql.exec("UPDATE balance SET spent = 0, month = ? WHERE id = 1", month());
		return { ...current, spent: 0, month: month() };
	}
	return current;
}

const reservedCents = (sql: SqlStorage) =>
	sql.exec<{ total: number | null }>("SELECT SUM(cents) AS total FROM reservations WHERE state = 'open'").one().total ?? 0;

export function balance(sql: SqlStorage): Balance {
	const current = state(sql);
	return { credits: current.credits, reserved: reservedCents(sql), spent: current.spent, limit: current.spend_limit };
}

/**
 * Holds `units` of `kind` before the work starts, or "insufficient" when the credits not already held, or the room left
 * under the spending limit, cannot cover them. Calls `journal` with the entry to record.
 */
export function reserve(
	sql: SqlStorage,
	kind: MeteredKind,
	units: number,
	journal: (entry: JournalEntry) => void,
): Reservation | "insufficient" {
	if (!Number.isInteger(units) || units < 1) throw new Error("units must be a positive whole number");
	const cents = unitCost(kind) * units;
	const current = state(sql);
	const held = reservedCents(sql);
	if (current.credits - held < cents) return "insufficient";
	if (current.spend_limit !== null && current.spent + held + cents > current.spend_limit) return "insufficient";
	const reservation: Reservation = { id: `res_${crypto.randomUUID()}`, kind, units, cents, createdAt: Date.now() };
	sql.exec(
		"INSERT INTO reservations (id, kind, units, cents, state, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
		reservation.id,
		kind,
		units,
		cents,
		reservation.createdAt,
	);
	journal({ key: `reserve:${reservation.id}`, kind: "reserve", cents, ref: reservation.id });
	return reservation;
}

/** Charges what was used (at most what was held) and releases the rest. Settling twice changes nothing. */
export function settle(sql: SqlStorage, reservationId: string, usedUnits: number, journal: (entry: JournalEntry) => void): void {
	const reservation = sql
		.exec<{ kind: MeteredKind; cents: number; state: string }>("SELECT kind, cents, state FROM reservations WHERE id = ?", reservationId)
		.toArray()[0];
	if (!reservation || reservation.state !== "open") return;
	const used = Math.min(reservation.cents, Math.max(0, Math.ceil(usedUnits)) * unitCost(reservation.kind));
	state(sql);
	sql.exec("UPDATE reservations SET state = 'settled', used = ? WHERE id = ?", used, reservationId);
	sql.exec("UPDATE balance SET credits = credits - ?, spent = spent + ? WHERE id = 1", used, used);
	journal({ key: `settle:${reservationId}`, kind: "settle", cents: used, ref: reservationId });
}

/** Adds credit once per `key` (a top-up's payment id), so a replayed webhook never adds it twice. */
export function grantCredits(sql: SqlStorage, cents: number, key: string, journal: (entry: JournalEntry) => void): void {
	if (!Number.isInteger(cents) || cents <= 0) throw new Error("a grant is a positive number of cents");
	const inserted = sql.exec("INSERT OR IGNORE INTO grants (key, cents, at) VALUES (?, ?, ?)", key, cents, Date.now()).rowsWritten;
	if (inserted === 0) return;
	sql.exec("UPDATE balance SET credits = credits + ? WHERE id = 1", cents);
	journal({ key: `grant:${key}`, kind: "grant", cents, ref: key });
}

export function setSpendingLimit(sql: SqlStorage, cents: number | null, journal: (entry: JournalEntry) => void): void {
	if (cents !== null && (!Number.isInteger(cents) || cents < 0)) throw new Error("a limit is zero or more cents");
	sql.exec("UPDATE balance SET spend_limit = ? WHERE id = 1", cents);
	journal({ key: `limit:${crypto.randomUUID()}`, kind: "limit", cents: cents ?? -1, ref: "" });
}
