import type { LaneState, Register, RegisterNamespace, RegisterValues } from "@knightcode/agent";
import { sql } from "../sql.ts";
import type { SqliteDatabase } from "../types.ts";

export interface RegisterRow {
	namespace: RegisterNamespace;
	key: string;
	seq: number;
	value: string;
}

export function insertInitialMainLaneRegisters(db: SqliteDatabase): void {
	const laneState = { currentOperationId: null, pendingNextRun: [] } satisfies LaneState;
	setRegisterRow(db, "lane.leaf", "main", 1, null);
	setRegisterRow(db, "lane.state", "main", 2, laneState);
}

export function setRegisterRow<TNamespace extends RegisterNamespace>(
	db: SqliteDatabase,
	namespace: TNamespace,
	key: string,
	seq: number,
	value: RegisterValues[TNamespace],
): void {
	sql`INSERT INTO registers (namespace, key, seq, value)
		VALUES (${namespace}, ${key}, ${seq}, ${JSON.stringify(value)})
		ON CONFLICT(namespace, key) DO UPDATE SET seq = excluded.seq, value = excluded.value`.run(db);
}

export function deleteRegisterRow(db: SqliteDatabase, namespace: RegisterNamespace, key: string): void {
	sql`DELETE FROM registers WHERE namespace = ${namespace} AND key = ${key}`.run(db);
}

export function decodeRegisterRow<TNamespace extends RegisterNamespace>(
	namespace: TNamespace,
	row: RegisterRow,
): Register<TNamespace> {
	if (row.namespace !== namespace) throw new Error(`Expected register namespace ${namespace}, found ${row.namespace}`);
	return {
		namespace,
		key: row.key,
		seq: row.seq,
		value: JSON.parse(row.value) as RegisterValues[TNamespace],
	};
}

export function readRegisterRow<TNamespace extends RegisterNamespace>(
	db: SqliteDatabase,
	namespace: TNamespace,
	key: string,
): Register<TNamespace> | undefined {
	const row = sql`SELECT namespace, key, seq, value FROM registers
		WHERE namespace = ${namespace} AND key = ${key}`.get<RegisterRow>(db);
	return row === undefined ? undefined : decodeRegisterRow(namespace, row);
}

function nextPrefixBoundary(prefix: string): string | undefined {
	if (prefix === "") return undefined;
	const codePoints = Array.from(prefix);
	for (let index = codePoints.length - 1; index >= 0; index--) {
		const codePoint = codePoints[index]?.codePointAt(0);
		if (codePoint === undefined) throw new Error("Invalid register key prefix");
		if (codePoint < 0x10ffff) {
			// Skipping the surrogate range keeps the bound a real scalar value, so
			// U+D7FF advances past it. A lone surrogate is itself stored as U+FFFD,
			// so its bound has to be U+FFFE or the scan excludes its own prefix.
			const nextCodePoint =
				codePoint === 0xd7ff ? 0xe000 : codePoint > 0xd7ff && codePoint < 0xe000 ? 0xfffe : codePoint + 1;
			return `${codePoints.slice(0, index).join("")}${String.fromCodePoint(nextCodePoint)}`;
		}
	}
	return undefined;
}

export function listRegisterRows<TNamespace extends RegisterNamespace>(
	db: SqliteDatabase,
	namespace: TNamespace,
	keyPrefix = "",
): Register<TNamespace>[] {
	const upperBound = nextPrefixBoundary(keyPrefix);
	const rows =
		upperBound === undefined
			? sql`SELECT namespace, key, seq, value FROM registers
				WHERE namespace = ${namespace} AND key >= ${keyPrefix}
				ORDER BY key ASC`.all<RegisterRow>(db)
			: sql`SELECT namespace, key, seq, value FROM registers
				WHERE namespace = ${namespace} AND key >= ${keyPrefix} AND key < ${upperBound}
				ORDER BY key ASC`.all<RegisterRow>(db);
	return rows.map((row) => decodeRegisterRow(namespace, row));
}
