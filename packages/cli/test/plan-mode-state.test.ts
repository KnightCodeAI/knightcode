import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { foldPlanState, transitionPlan } from "../src/extensions/plan-mode/state.ts";

describe("plan snapshots", () => {
	it("keeps drafts and approvals through exit, clearing approval only on enter and submit", () => {
		const entered = transitionPlan({ mode: "off" }, { type: "enter" });
		const submitted = transitionPlan(entered, { type: "submit", markdown: "# First" });
		expect(submitted).toEqual({ mode: "planning", draft: { revision: 1, markdown: "# First" } });
		const approved = transitionPlan(submitted, { type: "approve" });
		expect(approved).toEqual({ mode: "off", draft: { revision: 1, markdown: "# First" }, approved: 1 });
		expect(transitionPlan(approved, { type: "exit" })).toEqual(approved);
		const reentered = transitionPlan(approved, { type: "enter" });
		expect(reentered.approved).toBeUndefined();
		expect(transitionPlan(reentered, { type: "submit", markdown: "# Second" })).toEqual({
			mode: "planning",
			draft: { revision: 2, markdown: "# Second" },
		});
	});

	it("folds only the selected branch, not abandoned approvals", () => {
		const manager = SessionManager.inMemory();
		const planning = manager.appendCustomEntry("plan-mode", {
			mode: "planning",
			draft: { revision: 3, markdown: "draft" },
		});
		manager.appendCustomEntry("plan-mode", { mode: "off", draft: { revision: 3, markdown: "draft" }, approved: 3 });
		manager.branch(planning);
		expect(foldPlanState(manager.getBranch())).toEqual({ mode: "planning", draft: { revision: 3, markdown: "draft" } });
	});

	it("does not silently disable planning when saved state is malformed", () => {
		const manager = SessionManager.inMemory();
		manager.appendCustomEntry("plan-mode", { mode: "broken" });
		expect(() => foldPlanState(manager.getBranch())).toThrow(/saved plan/i);
	});
});
