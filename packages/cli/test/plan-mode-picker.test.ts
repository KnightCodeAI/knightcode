import { beforeAll, describe, expect, it } from "vitest";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import planMode from "../src/extensions/plan-mode/index.ts";
import { createHarness } from "./suite/harness.ts";

beforeAll(() => initTheme("dark"));

describe("submit_plan rendering", () => {
	it("shows the plan once, from the call, and still shows submission errors", async () => {
		const h = await createHarness({ extensionFactories: [planMode] });
		try {
			const tool = h.session.extensionRunner
				.getAllRegisteredTools()
				.find((t) => t.definition.name === "submit_plan")!.definition;
			const render = (isError: boolean, text: string) =>
				tool.renderResult!(
					{ content: [{ type: "text", text }], details: { revision: 1, markdown: "# Plan" }, isError } as never,
					{ expanded: true, isPartial: false },
					theme,
					{ args: { markdown: "# Plan" } } as never,
				)
					.render(80)
					.join("\n");
			expect(render(true, "Submit a non-empty Markdown plan.")).toContain("Submit a non-empty Markdown plan.");
			expect(render(false, "Submitted as revision 1.").trim()).toBe("");
			expect(
				tool.renderCall!({ markdown: "# Plan" }, theme, {} as never)
					.render(80)
					.join("\n"),
			).toContain("Plan");
			expect(() => tool.renderCall!({ markdown: 123 }, theme, {} as never).render(80)).not.toThrow();
		} finally {
			h.cleanup();
		}
	});
});
