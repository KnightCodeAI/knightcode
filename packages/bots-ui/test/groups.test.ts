import type { Bot, ConversationView } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { clusterCells } from "../src/groups/GroupAvatar.tsx";
import { membersProblem } from "../src/groups/CreateGroup.tsx";
import { turnText } from "../src/groups/TurnIndicator.tsx";

describe("groups", () => {
	it("holds 2 to 10 bots with a member as lead", () => {
		expect(membersProblem(["a"], "a")).toMatch(/at least 2/);
		expect(membersProblem(["a", "b"], "a")).toBeUndefined();
		expect(membersProblem(["a", "b"], "c")).toMatch(/lead/);
		expect(
			membersProblem(
				Array.from({ length: 11 }, (_, i) => `b${i}`),
				"b0",
			),
		).toMatch(/at most 10/);
	});
	it("draws up to four members, then three and a count", () => {
		expect([1, 2, 3, 4, 5, 10].map(clusterCells)).toEqual([
			{ bots: 1, more: 0 },
			{ bots: 2, more: 0 },
			{ bots: 3, more: 0 },
			{ bots: 4, more: 0 },
			{ bots: 3, more: 2 },
			{ bots: 3, more: 7 },
		]);
	});
	it("says who is replying", () => {
		const bots = new Map([
			["r", { name: "Reviewer" } as Bot],
			["s", { name: "Social" } as Bot],
		]);
		const view = (streaming: string[], running = true): ConversationView => ({
			running,
			hasEarlier: false,
			entries: streaming.map((botId, i) => ({
				kind: "message",
				id: `m${i}`,
				role: "assistant",
				text: "",
				createdAt: i,
				botId,
				streaming: true,
			})),
		});
		expect(turnText(view([], false), bots)).toBeUndefined();
		expect(turnText(view(["r"]), bots)).toBe("Reviewer is replying…");
		expect(turnText(view(["r", "s"]), bots)).toBe("Reviewer and Social are replying…");
	});
});
