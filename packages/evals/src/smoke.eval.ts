import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createKnightCodeHarness } from "./knightcode-harness.ts";

const knightCodeHarness = createKnightCodeHarness({ noTools: "all" });

describeEval("KnightCode smoke", { harness: knightCodeHarness }, (it) => {
	it("runs a basic prompt end to end", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");

		expect(result.output.trim()).toBe("Paris");
		expect(result.errors).toEqual([]);
		expect(result.usage.provider).toBe(process.env.KNIGHTCODE_PROVIDER);
		expect(result.usage.model).toBe(process.env.KNIGHTCODE_MODEL);
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	});
});
