import { describe, expect, it } from "vitest";
import { openItems } from "../src/onboarding/Checklist.tsx";
import { previewAction } from "../src/settings/Approvals.tsx";
import { validTopUp } from "../src/settings/Billing.tsx";
import { anchorOf } from "../src/settings/parts.tsx";

describe("settings", () => {
	const rules = {
		allow: [{ id: "a", kind: "tool" as const, value: "github.comment" }],
		block: [{ id: "b", kind: "site" as const, value: "https://bank.example.com" }],
	};
	it("previews what happens to an action in each mode", () => {
		expect(previewAction({ mode: "never", ...rules }, "https://bank.example.com/pay")).toMatch(/^Refused/);
		expect(previewAction({ mode: "ask", ...rules }, "github.comment")).toMatch(
			/without asking: it is on the Always allow/,
		);
		expect(previewAction({ mode: "ask", ...rules }, "email.send")).toMatch(/^Asks first/);
		expect(previewAction({ mode: "auto", ...rules }, "email.send")).toMatch(/reviewer/);
		expect(previewAction({ mode: "ask", ...rules }, "  ")).toBe("");
	});
	it("refuses top-ups under $5", () => {
		expect(validTopUp(4)).toBe(false);
		expect(validTopUp(4.99)).toBe(false);
		expect(validTopUp(5)).toBe(true);
		expect(validTopUp(Number.NaN)).toBe(false);
	});
	it("makes anchors and lists open onboarding steps", () => {
		expect(anchorOf("Model for new bots")).toBe("model-for-new-bots");
		expect(
			openItems([
				{ id: "bot", done: true },
				{ id: "app", done: false },
			]).map((i) => i.id),
		).toEqual(["app"]);
	});
});
