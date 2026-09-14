import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createKnightCodeHarness } from "./knightcode-harness.ts";

const knightCodeHarness = createKnightCodeHarness({ noTools: "all" });

describeEval("Answer a basic prompt", { harness: knightCodeHarness }, (it) => {
	it("returns the expected answer", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");

		expect(result.output.trim()).toBe("Paris");
		expect(result.errors).toEqual([]);
		expect(result.usage.provider).toBe(process.env.KNIGHTCODE_PROVIDER);
		expect(result.usage.model).toBe(process.env.KNIGHTCODE_MODEL);
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	});
});
