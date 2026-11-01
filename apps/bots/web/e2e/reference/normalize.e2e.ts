import { expect, test } from "@playwright/test";
import { normalize } from "./compare.ts";

test("normalize spells equal styles the same way", () => {
	expect(normalize("color(srgb 0.960784 0.960784 0.960784 / 0.3)")).toBe("rgba(245, 245, 245, 0.3)");
	expect(normalize("rgba(245, 245, 245, 0.04) none")).toBe("rgba(245, 245, 245, 0.04)");
	expect(normalize("rgba(0, 0, 0, 0.05) 0px 2.004px 8px -1px")).toBe("rgba(0, 0, 0, 0.05) 0px 2px 8px -1px");
});
