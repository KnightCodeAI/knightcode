import { visibleWidth } from "@knightcode/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { PlanReviewPicker } from "../src/extensions/plan-mode/picker.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import planMode from "../src/extensions/plan-mode/index.ts";
import { createHarness } from "./suite/harness.ts";

beforeAll(() => initTheme("dark"));

describe("plan pickers", () => {
	it("shows submission errors instead of blank Markdown and tolerates invalid call arguments", async () => {
		const h = await createHarness({ extensionFactories: [planMode] });
		try {
			const tool = h.session.extensionRunner
				.getAllRegisteredTools()
				.find((t) => t.definition.name === "submit_plan")!.definition;
			const result = tool.renderResult!(
				{ content: [{ type: "text", text: "Submit a non-empty Markdown plan." }], details: undefined },
				{ expanded: true, isPartial: false },
				theme,
				{ args: { markdown: "   " } } as never,
			);
			expect(result.render(80).join("\n")).toContain("Submit a non-empty Markdown plan.");
			expect(() => tool.renderCall!({ markdown: 123 }, theme, {} as never).render(80)).not.toThrow();
		} finally {
			h.cleanup();
		}
	});

	it("aborts the review picker once and removes its listener on dispose", () => {
		const controller = new AbortController();
		const done = vi.fn();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const picker = new PlanReviewPicker(
			"# Plan",
			1,
			25,
			theme,
			new KeybindingsManager(),
			done,
			() => {},
			() => 24,
			controller.signal,
		);
		controller.abort();
		picker.handleInput("\r");
		expect(done).toHaveBeenCalledTimes(1);
		expect(done).toHaveBeenCalledWith(undefined);
		picker.dispose();
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	it("keeps review bounded and readable at narrow widths, and defaults Escape to keep planning", () => {
		const done = vi.fn();
		const picker = new PlanReviewPicker(
			"# Plan\n\n" + "A long line of changes.\n".repeat(50),
			3,
			42,
			theme,
			new KeybindingsManager(),
			done,
			() => {},
			() => 24,
		);
		for (const width of [8, 40, 80]) {
			const lines = picker.render(width);
			expect(lines.length).toBeLessThanOrEqual(24);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		picker.handleInput("\x1b");
		expect(done).toHaveBeenCalledWith(undefined);
		picker.dispose();
	});
});
