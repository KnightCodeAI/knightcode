import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	ClientFrameSchema,
	decodeFrame,
	parse,
	parseRecipe,
	ProtocolError,
	RECIPE_MAX_BYTES,
	ROUTES,
	RoutineSchema,
	type RunStatus,
} from "../src/index.ts";

const routeOf = (name: string) => ROUTES.find((r) => r.name === name)!;

function errorOf(run: () => unknown): ProtocolError {
	try {
		run();
	} catch (error) {
		if (error instanceof ProtocolError) return error;
		throw error;
	}
	throw new Error("expected a ProtocolError");
}

describe("parse errors", () => {
	it("names the missing field of the union branch the discriminator selects", () => {
		const error = errorOf(() => parse(ClientFrameSchema, { type: "submit", botId: "b1", text: "hi" }));
		expect(error.path).toBe("/requestId");
	});

	it("reports an unknown discriminator at its own path", () => {
		const error = errorOf(() => parse(ClientFrameSchema, { type: "nope" }));
		expect(error.path).toBe("/type");
		expect(error.message).toMatch(/nope/);
	});

	it("rejects a thread frame naming both a bot and a group", () => {
		expect(() => decodeFrame(JSON.stringify({ type: "stop", botId: "b1", groupId: "g1" }))).toThrow(ProtocolError);
	});
});

describe("recipes", () => {
	it("drops unknown fields at every depth", () => {
		const recipe = parseRecipe({
			profile: { name: "X", description: "d", extra: 1 },
			memory: [{ content: "m", extra: 1 }],
			skills: [],
			routines: [],
			plugins: [],
			extra: 1,
		});
		expect(JSON.stringify(recipe)).not.toContain("extra");
	});

	it("refuses a recipe over 25 MB", () => {
		expect(() => parseRecipe("x".repeat(RECIPE_MAX_BYTES + 1))).toThrow(/25 MB/);
	});
});

describe("limits and secrets in the contracts", () => {
	it("holds automatic top-ups to the $5 minimum", () => {
		expect(() => parse(routeOf("setAutoTopUp").request, { enabled: true, threshold: 1, amount: 1 })).toThrow(
			ProtocolError,
		);
		expect(parse(routeOf("setAutoTopUp").request, { enabled: true, threshold: 1, amount: 5 })).toBeTruthy();
	});

	it("keeps a webhook's secret URL out of every routine record", () => {
		const routine = {
			id: "r",
			botId: "b",
			name: "n",
			prompt: "p",
			triggers: [{ kind: "webhook", id: "w", url: "https://bots.knightcode.dev/hooks/w/secret" }],
			grant: { actions: [], targets: [], limits: {} },
			active: true,
		};
		expect(Value.Check(RoutineSchema, routine)).toBe(false);
		expect(
			Value.Check(routeOf("mintWebhook").response, { trigger: { kind: "webhook", id: "w" }, url: "https://x" }),
		).toBe(true);
	});
});

describe("routes the screens need", () => {
	it.each([
		"getFile",
		"getGroupHistory",
		"reactInGroup",
		"getExchange",
		"appAction",
		"completeBankLink",
		"beginEnrollment",
		"completeEnrollment",
		"discardSkillDraft",
		"answerSecretRequest",
		"listAppEvents",
		"getPageVersion",
		"restorePageVersion",
	])("has %s", (name) => {
		expect(ROUTES.map((r) => r.name)).toContain(name);
	});

	it("lets the user choose the default and helper models on their account", () => {
		const properties = routeOf("updateAccount").request.properties;
		expect(Object.keys(properties)).toEqual(expect.arrayContaining(["defaultModel", "helperModels"]));
		expect(() => parse(routeOf("updateAccount").request, { defaultModel: { provider: "fake" } })).toThrow(
			ProtocolError,
		);
	});
});

describe("static types", () => {
	it("keeps literal unions literal", () => {
		// @ts-expect-error "nope" is not a run status
		const bad: RunStatus = "nope";
		expect(bad).toBe("nope");
	});
});
