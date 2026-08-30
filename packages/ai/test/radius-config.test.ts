import { describe, expect, it } from "vitest";
import { getRadiusCredentialConfig } from "../src/providers/radius-config.ts";
import type { OAuthCredential } from "../src/auth/types.ts";

const COST = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 };

function model(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "radius-model",
		name: "Radius Model",
		reasoning: false,
		input: ["text"],
		cost: COST,
		contextWindow: 200000,
		maxTokens: 8192,
		...overrides,
	};
}

function credential(models: unknown[]): OAuthCredential {
	return {
		type: "oauth",
		access: "token",
		refresh: "refresh",
		expires: 0,
		gatewayConfig: { baseUrl: "https://radius.example", models },
	} as unknown as OAuthCredential;
}

describe("Radius gateway config validation", () => {
	it("accepts a well-formed catalog, tiers included", () => {
		const withTiers = model({ id: "tiered", cost: { ...COST, tiers: [{ ...COST, inputTokensAbove: 200000 }] } });
		const config = getRadiusCredentialConfig(credential([model(), withTiers]));
		expect(config?.models.map((entry) => entry.id)).toEqual(["radius-model", "tiered"]);
	});

	it.each([
		["empty cost", model({ cost: {} })],
		["missing a rate", model({ cost: { input: 1, output: 2, cacheRead: 0.1 } })],
		["non-array tiers", model({ cost: { ...COST, tiers: "cheap" } })],
		["tier without a threshold", model({ cost: { ...COST, tiers: [COST] } })],
		["a negative rate", model({ cost: { ...COST, output: -1 } })],
		["a NaN rate", model({ cost: { ...COST, input: Number.NaN } })],
		["an infinite rate", model({ cost: { ...COST, cacheWrite: Number.POSITIVE_INFINITY } })],
	])("rejects the whole config when a model has %s", (_label, bad) => {
		// calculateCost divides by every rate and iterates tiers, and a silently emptied catalog
		// would be persisted over the cached one — so one bad model invalidates the response.
		expect(getRadiusCredentialConfig(credential([model(), bad]))).toBeUndefined();
	});

	it("rejects an empty catalog", () => {
		// `[].every(...)` is true, so this passed validation and the refresh in radius.ts persisted
		// the empty catalog over the cached models.
		expect(getRadiusCredentialConfig(credential([]))).toBeUndefined();
	});
});
