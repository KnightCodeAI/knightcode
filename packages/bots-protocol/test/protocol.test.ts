// packages/bots-protocol/test/protocol.test.ts
import { describe, expect, it } from "vitest";
import { AVATAR_SHAPES, decodeFrame, encodeFrame, parseRecipe, ROUTES } from "../src/index.ts";

describe("contracts", () => {
	it("knows the 25 avatar shapes", () => {
		expect(AVATAR_SHAPES).toHaveLength(25);
		expect(new Set(AVATAR_SHAPES).size).toBe(25);
	});
	it("parses a recipe and rejects a getting-started skill it does not contain", () => {
		const recipe = {
			profile: { name: "Inbox", description: "Triage mail" },
			memory: [],
			skills: [{ name: "triage", description: "d", content: "c" }],
			routines: [],
			plugins: [],
			gettingStarted: { skill: "triage" },
		};
		expect(parseRecipe(recipe).profile.name).toBe("Inbox");
		expect(() => parseRecipe({ ...recipe, gettingStarted: { skill: "missing" } })).toThrow(/gettingStarted/);
	});
	it("round-trips frames and rejects unknown types", () => {
		const frame = { type: "submit", botId: "b1", text: "hi", requestId: "r1" } as const;
		expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
		expect(() => decodeFrame(JSON.stringify({ type: "nope" }))).toThrow();
	});
	it("has one route per method and path", () => {
		const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
