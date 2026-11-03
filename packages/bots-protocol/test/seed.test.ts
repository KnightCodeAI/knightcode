// Checks that the default fake world has usable small and large group conversations.
import { describe, expect, it } from "vitest";
import { createApiClient, createFakeBackend } from "../src/index.ts";

describe("default group seed", () => {
	it.each([
		{ groupId: "operations", count: 4 },
		{ groupId: "all-hands", count: 7 },
	])("serves $groupId with $count distinct bots and a conversation", async ({ groupId, count }) => {
		const fake = createFakeBackend();
		const api = createApiClient(fake.fetch, "https://bots.test");
		const group = await api.getGroup({ groupId });
		expect(new Set(group.memberIds).size).toBe(count);
		expect(group.memberIds).toContain(group.leadId);
		const { bots } = await api.listBots({});
		for (const id of group.memberIds) expect(bots.some((bot) => bot.id === id)).toBe(true);
		const { entries } = await api.getGroupHistory({ groupId });
		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			if (entry.kind === "message" && entry.role === "assistant") {
				expect(group.memberIds).toContain(entry.botId);
			}
		}
	});
});
