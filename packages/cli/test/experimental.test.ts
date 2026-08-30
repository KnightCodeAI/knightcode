import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalPiExperimental = process.env.KNIGHTCODE_EXPERIMENTAL;

	afterEach(() => {
		if (originalPiExperimental === undefined) {
			delete process.env.KNIGHTCODE_EXPERIMENTAL;
		} else {
			process.env.KNIGHTCODE_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false when KNIGHTCODE_EXPERIMENTAL is unset", () => {
		delete process.env.KNIGHTCODE_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when KNIGHTCODE_EXPERIMENTAL is empty", () => {
		process.env.KNIGHTCODE_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when KNIGHTCODE_EXPERIMENTAL is set to 1", () => {
		process.env.KNIGHTCODE_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when KNIGHTCODE_EXPERIMENTAL is set to 0", () => {
		process.env.KNIGHTCODE_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when KNIGHTCODE_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.KNIGHTCODE_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
