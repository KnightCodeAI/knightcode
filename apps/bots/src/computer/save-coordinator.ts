// The save coordinator (spec section 7): one per computer, owning every save. Each save holds a lease with a fencing
// generation; a newer lease fences every older one, so a stale job can never publish. Saves are immutable, numbered
// generations, and a save that fails or is fenced leaves the previous completed one as the truth. On wake the
// snapshot is the fast path only when its generation matches the newest completed save.
import type { SnapshotHandle } from "./provider.ts";

export interface Lease {
	generation: number;
	job: string;
}

export interface SaveRecord {
	generation: number;
	job: string;
	state: "leased" | "completed" | "failed" | "fenced";
	completedAt?: number;
}

export class Fenced extends Error {
	constructor(generation: number) {
		super(`save ${generation} was fenced by a newer save`);
		this.name = "Fenced";
	}
}

/** Snapshots expire after 30 days without a restore (the platform's rule); R2 is the source of truth. */
export const SNAPSHOT_TTL_MS = 30 * 86_400_000;

export type RestorePlan =
	| { kind: "snapshot"; handle: SnapshotHandle }
	| { kind: "archive"; generation: number }
	| { kind: "fresh" };

type Row = { generation: number; job: string; state: SaveRecord["state"]; completed_at: number | null };

export class SaveCoordinator {
	readonly #sql: SqlStorage;
	readonly #upload: (lease: Lease) => Promise<void>;
	readonly #now: () => number;

	/** `upload` writes the generation's archive (immutable, under its own number) and resolves once it is complete. */
	constructor(sql: SqlStorage, upload: (lease: Lease) => Promise<void>, now: () => number = Date.now) {
		this.#sql = sql;
		this.#upload = upload;
		this.#now = now;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS saves (generation INTEGER PRIMARY KEY, job TEXT NOT NULL, state TEXT NOT NULL, completed_at INTEGER)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, generation INTEGER NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER NOT NULL)",
		);
	}

	/** A new lease, one generation past every earlier one; it fences any save still holding an older lease. */
	acquire(job: string): Lease {
		const top = this.#sql.exec<{ g: number | null }>("SELECT MAX(generation) AS g FROM saves").one().g ?? 0;
		const generation = top + 1;
		this.#sql.exec("UPDATE saves SET state = 'fenced' WHERE state = 'leased'");
		this.#sql.exec("INSERT INTO saves (generation, job, state) VALUES (?, ?, 'leased')", generation, job);
		return { generation, job };
	}

	#holds(lease: Lease): boolean {
		const row = this.#sql.exec<Row>("SELECT * FROM saves WHERE generation = ?", lease.generation).toArray()[0];
		return row?.state === "leased" && row.job === lease.job;
	}

	/** Uploads and publishes `lease`'s generation, or rejects with `Fenced` when a newer lease took over. */
	async save(lease: Lease): Promise<{ generation: number }> {
		if (!this.#holds(lease)) throw new Fenced(lease.generation);
		try {
			await this.#upload(lease);
		} catch (error) {
			if (this.#holds(lease)) this.#sql.exec("UPDATE saves SET state = 'failed' WHERE generation = ?", lease.generation);
			throw error;
		}
		// Checked again after the upload: a lease taken meanwhile wins, and this one never publishes.
		if (!this.#holds(lease)) throw new Fenced(lease.generation);
		this.#sql.exec("UPDATE saves SET state = 'completed', completed_at = ? WHERE generation = ?", this.#now(), lease.generation);
		return { generation: lease.generation };
	}

	latestCompleted(): SaveRecord | undefined {
		const row = this.#sql
			.exec<Row>("SELECT * FROM saves WHERE state = 'completed' ORDER BY generation DESC LIMIT 1")
			.toArray()[0];
		return row && { generation: row.generation, job: row.job, state: row.state, completedAt: row.completed_at ?? undefined };
	}

	recordSnapshot(handle: SnapshotHandle): void {
		this.#sql.exec(
			"INSERT OR REPLACE INTO snapshots (id, generation, created_at, used_at) VALUES (?, ?, ?, ?)",
			handle.id,
			handle.generation,
			handle.createdAt,
			handle.createdAt,
		);
	}

	/** Restore from the snapshot only when it is of the newest completed save and unexpired; else that save's archive. */
	restorePlan(): RestorePlan {
		const latest = this.latestCompleted();
		if (!latest) return { kind: "fresh" };
		const snapshot = this.#sql
			.exec<{ id: string; generation: number; created_at: number; used_at: number }>(
				"SELECT * FROM snapshots WHERE generation = ? ORDER BY created_at DESC LIMIT 1",
				latest.generation,
			)
			.toArray()[0];
		if (snapshot && this.#now() - snapshot.used_at < SNAPSHOT_TTL_MS) {
			this.#sql.exec("UPDATE snapshots SET used_at = ? WHERE id = ?", this.#now(), snapshot.id);
			return { kind: "snapshot", handle: { id: snapshot.id, generation: snapshot.generation, createdAt: snapshot.created_at } };
		}
		return { kind: "archive", generation: latest.generation };
	}
}
