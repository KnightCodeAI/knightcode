import { describe, expect, it } from "vitest";
import { VIRTUAL_MODULES } from "../../../src/core/extensions/virtual-modules.ts";

// Extensions importing @knightcode/ai/models (for example clampThinkingLevel) failed with
// "Cannot find module" in embedded runtimes because the subpath was missing from the virtual module map.
describe("@knightcode/ai/models virtual module", () => {
	it("exposes the @knightcode/ai/models entrypoint to extensions", () => {
		const models = VIRTUAL_MODULES["@knightcode/ai/models"] as { clampThinkingLevel?: unknown } | undefined;
		expect(models).toBeDefined();
		expect(typeof models?.clampThinkingLevel).toBe("function");
	});
});
