import { expect, it } from "vitest";
import { checkName } from "../src/index.ts";

it("accepts lowercase handles of 3 to 20 characters and refuses reserved ones", () => {
	expect(checkName("raghav")).toBe("ok");
	expect(checkName("chief-of-staff")).toBe("ok");
	expect(checkName("Raghav")).toBe("invalid");
	expect(checkName("ab")).toBe("invalid");
	expect(checkName("a".repeat(21))).toBe("invalid");
	expect(checkName("admin")).toBe("reserved");
	expect(checkName("postmaster")).toBe("reserved");
});
