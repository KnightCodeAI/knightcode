import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../src/harness/session/memory.ts";

const NOW = 1_700_000_000_000;

describe("MemoryStorage", () => {
	it("uses the injected clock once per transaction", async () => {
		let timestamp = NOW;
		const storage = new MemoryStorage({ now: () => timestamp++ });

		const first = await storage.commit({
			writes: [
				{
					kind: "entry",
					entry: {
						id: "first",
						parentId: null,
						type: "custom",
						customType: "note",
					},
				},
				{ kind: "register", op: "set", namespace: "fact.name", key: "", value: "first" },
			],
		});
		const second = await storage.commit({
			writes: [{ kind: "register", op: "set", namespace: "fact.name", key: "", value: "second" }],
		});

		expect(first.timestamp).toBe(NOW);
		expect(second.timestamp).toBe(NOW + 1);
		expect((await storage.getEntries(["first"])).get("first")?.timestamp).toBe(first.timestamp);
		await storage.close();
	});

	// close() chains onto the commit queue, so a deep queue resolves entirely before it does.
	// A close that only yields once would leave most of these unsettled.
	it("drains a queue of admitted commits before close resolves", async () => {
		const storage = new MemoryStorage({ now: () => NOW });
		const commits = Array.from({ length: 50 }, (_, index) =>
			storage.commit({
				writes: [
					{
						kind: "entry",
						entry: {
							id: `entry-${index}`,
							parentId: index === 0 ? null : `entry-${index - 1}`,
							type: "custom",
							customType: "note",
						},
					},
				],
			}),
		);
		let settled = 0;
		for (const commit of commits) {
			void commit.then(() => {
				settled++;
			});
		}

		await storage.close();

		expect(settled).toBe(commits.length);
		expect((await Promise.all(commits)).map((result) => result.seqs[0])).toEqual(
			Array.from({ length: 50 }, (_, index) => index + 1),
		);
	});
});
