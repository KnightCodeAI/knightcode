// apps/bots/test/save-coordinator.test.ts
import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { type Lease, SaveCoordinator } from "../src/computer/save-coordinator.ts";

it("never publishes a stale save and keeps the previous generation on a crash", async () => {
	await withStorage("coordinator-a", async (sql) => {
		const { coordinator, uploads, crashNext } = newCoordinator(sql);
		const lease = async (job: string) => coordinator.acquire(job);
		const a = coordinator.save(await lease("job-a"));
		const b = coordinator.save(await lease("job-b"));
		await expect(a).rejects.toThrow(/fenced/);
		expect((await b).generation).toBe(2);
		// Job a's upload ran to the end, but its generation was never published.
		expect(uploads).toContain(1);
		crashNext();
		await expect(coordinator.save(await lease("job-c"))).rejects.toThrow(/crashed/);
		expect(coordinator.latestCompleted()?.generation).toBe(2);
		// A lease that was fenced before it began never uploads at all.
		const d = await lease("job-d");
		await lease("job-e");
		await expect(coordinator.save(d)).rejects.toThrow(/fenced/);
		expect(uploads).not.toContain(d.generation);
	});
});

it("restores a snapshot only when its generation matches the latest save", async () => {
	await withStorage("coordinator-b", async (sql) => {
		const { coordinator } = newCoordinator(sql);
		const saveGeneration = async (generation: number) => {
			let lease = coordinator.acquire("save");
			while (lease.generation < generation) lease = coordinator.acquire("save");
			await coordinator.save(lease);
		};
		const snapshotGeneration = (generation: number) =>
			coordinator.recordSnapshot({ id: `snap-${generation}`, generation, createdAt: Date.now() });
		const restoreSource = () => {
			const plan = coordinator.restorePlan();
			return plan.kind === "snapshot" ? `snapshot:${plan.handle.generation}` : plan.kind === "archive" ? `archive:${plan.generation}` : "fresh";
		};
		expect(restoreSource()).toBe("fresh");
		await saveGeneration(3);
		snapshotGeneration(2);
		expect(restoreSource()).toBe("archive:3");
		snapshotGeneration(3);
		expect(restoreSource()).toBe("snapshot:3");
	});
});

it("ignores a snapshot unused for 30 days", async () => {
	await withStorage("coordinator-c", async (sql) => {
		let now = Date.UTC(2026, 0, 1);
		const coordinator = new SaveCoordinator(sql, async () => {}, () => now);
		await coordinator.save(coordinator.acquire("save"));
		coordinator.recordSnapshot({ id: "snap-1", generation: 1, createdAt: now });
		now += 31 * 86_400_000;
		expect(coordinator.restorePlan()).toEqual({ kind: "archive", generation: 1 });
	});
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Runs `fn` on a fresh computer object's SQLite. */
const withStorage = (name: string, fn: (sql: SqlStorage) => Promise<void>) =>
	runInDurableObject(env.COMPUTER.get(env.COMPUTER.idFromName(name)), (_instance, state) => fn(state.storage.sql));

/** A coordinator whose uploads take a moment, record their generation, and can be made to crash. */
function newCoordinator(sql: SqlStorage) {
	const uploads: number[] = [];
	let crash = false;
	const coordinator = new SaveCoordinator(sql, async (lease: Lease) => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		if (crash) {
			crash = false;
			throw new Error("upload crashed mid-way");
		}
		uploads.push(lease.generation);
	});
	return { coordinator, uploads, crashNext: () => void (crash = true) };
}
