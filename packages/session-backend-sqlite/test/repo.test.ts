import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SqliteDatabase } from "../src/index.ts";
import { createNodeSqliteFactory, SqliteSessionRepo, sql } from "../src/index.ts";

type TestMetadata = { id: string; path: string; createdAt: number; storageVersion: number };

async function withTempDir<T>(run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "knightcode-sqlite-session-"));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function withDb<T>(path: string, run: (db: SqliteDatabase) => Promise<T> | T): Promise<T> {
	const db = await createNodeSqliteFactory().open(path);
	try {
		return await run(db);
	} finally {
		db.close();
	}
}

describe("SqliteSessionRepo", () => {
	it("creates one initialized session file with main lane registers", async () => {
		await withTempDir(async (directory) => {
			const repo = new SqliteSessionRepo({
				directory,
				databaseFactory: createNodeSqliteFactory(),
				now: () => 1_700_000_000_000,
			});

			const metadata = (await repo.create({ id: "session" })) as TestMetadata;
			expect(metadata).toMatchObject({
				id: "session",
				createdAt: 1_700_000_000_000,
				storageVersion: 1,
			});
			expect(metadata.path).toBe(join(directory, "session.sqlite"));

			await withDb(metadata.path, (db) => {
				expect(sql`SELECT COUNT(*) AS count FROM session`.get<{ count: number }>(db)).toEqual({ count: 1 });
				expect(sql`SELECT message_count, usage_payload, next_seq FROM session`.get(db)).toEqual({
					message_count: 0,
					usage_payload: JSON.stringify({
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					}),
					next_seq: 3,
				});
				expect(sql`SELECT namespace, key, seq, value FROM registers ORDER BY seq`.all(db)).toEqual([
					{ namespace: "lane.leaf", key: "main", seq: 1, value: "null" },
					{
						namespace: "lane.state",
						key: "main",
						seq: 2,
						value: JSON.stringify({ currentOperationId: null, pendingNextRun: [] }),
					},
				]);
			});
		});
	});

	it("lists sessions without taking the writer lease", async () => {
		await withTempDir(async (directory) => {
			const repo = new SqliteSessionRepo({
				directory,
				databaseFactory: createNodeSqliteFactory(),
				now: () => 1,
			});
			const metadata = (await repo.create({ id: "session" })) as TestMetadata;

			await expect(repo.list()).resolves.toMatchObject([{ id: "session", path: metadata.path }]);
			await withDb(metadata.path, (db) => {
				expect(sql`SELECT owner_id, fence FROM writer_lease`.all(db)).toEqual([]);
			});
		});
	});

	it("opens a session through the version gate and rejects a live external writer lease", async () => {
		await withTempDir(async (directory) => {
			const repo = new SqliteSessionRepo({
				directory,
				databaseFactory: createNodeSqliteFactory(),
				now: () => 1,
			});
			const metadata = (await repo.create({ id: "session" })) as TestMetadata;

			await expect(repo.open(metadata)).resolves.toMatchObject({ id: "session", path: metadata.path });

			await withDb(metadata.path, (db) => {
				sql`INSERT INTO writer_lease (owner_id, fence, expires_at_ms) VALUES (${"external"}, ${1}, ${1_000})`.run(db);
			});
			await expect(repo.open(metadata)).rejects.toThrow("already claimed");
		});
	});
});

describe("SqliteSessionRepo safety", () => {
	it("leaves an existing session untouched when create is given a duplicate id", async () => {
		await withTempDir(async (directory) => {
			const repo = new SqliteSessionRepo({ directory, databaseFactory: createNodeSqliteFactory() });
			const first = (await repo.create({ id: "duplicate" })) as TestMetadata;

			await expect(repo.create({ id: "duplicate" })).rejects.toThrow();

			await access(first.path);
			const reopened = (await repo.open(first as never)) as TestMetadata;
			expect(reopened.id).toBe("duplicate");
		});
	});

	it("does not remove a pre-existing non-database file when create fails", async () => {
		await withTempDir(async (directory) => {
			const repo = new SqliteSessionRepo({ directory, databaseFactory: createNodeSqliteFactory() });
			const path = join(directory, "session.sqlite");
			await writeFile(path, "not a sqlite database");

			await expect(repo.create({ id: "session" })).rejects.toThrow();
			await expect(access(path)).resolves.toBeUndefined();
		});
	});

	it("keeps a traversing id inside the repository directory", async () => {
		await withTempDir(async (directory) => {
			const repo = new SqliteSessionRepo({ directory, databaseFactory: createNodeSqliteFactory() });
			const metadata = (await repo.create({ id: "../escape" })) as TestMetadata;

			expect(resolve(dirname(metadata.path))).toBe(resolve(directory));
			await access(metadata.path);
		});
	});
});
