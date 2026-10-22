import type { View, Widget } from "@knightcode/app-server-protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("../../src/renderer/client.ts", () => ({ client: { host: () => Promise.resolve({}) } }));

import { ViewNode, WidgetPanel } from "../../src/renderer/components/view.tsx";

const html = (view: View, live = false) =>
	renderToStaticMarkup(createElement(ViewNode, { view, ...(live ? { onEvent: () => {} } : {}) }));
const panel = (widgets: Widget[]) => renderToStaticMarkup(createElement(WidgetPanel, { widgets, onEvent: () => {} }));

test("each tone gives its theme class", () => {
	const classes = {
		muted: "text-tertiary",
		accent: "text-accent",
		success: "text-success",
		warning: "text-warning",
		error: "text-danger-text",
	};
	for (const [tone, cls] of Object.entries(classes))
		expect(html({ type: "text", text: "x", tone: tone as keyof typeof classes })).toContain(cls);
});

test("markdown in a view renders no script and no image", () => {
	const out = html({ type: "markdown", markdown: "<script>alert(1)</script>\n\n![x](https://example.com/x.png)" });
	expect(out).not.toContain("<script");
	expect(out).not.toContain("<img");
});

test("controls are disabled without onEvent and enabled with it", () => {
	const controls: View[] = [
		{ type: "button", id: "go", label: "Go" },
		{ type: "field", id: "name", kind: "text", label: "Name", value: "Ada" },
		{ type: "field", id: "on", kind: "toggle", label: "On", value: true },
		{ type: "field", id: "mode", kind: "select", label: "Mode", value: "fast", options: ["fast", "slow"] },
	];
	for (const control of controls) {
		expect(html(control), control.type).toMatch(/disabled=""/);
		expect(html(control, true), control.type).not.toMatch(/disabled=""/);
	}
});

test("progress over its max is drawn full", () => {
	const out = html({ type: "progress", value: 150, max: 100, label: "tests" });
	expect(out).toContain('aria-valuenow="150"');
	expect(out).toContain("width:100%");
});

test("a table renders its header and cells", () => {
	const out = html({ type: "table", columns: ["test", "result"], rows: [["parser", "failed"]] });
	expect(out).toMatch(/<th>test<\/th><th>result<\/th>/);
	expect(out).toMatch(/<td>parser<\/td><td>failed<\/td>/);
});

test("a widget panel shows at most 10 lines and puts those above the editor first", () => {
	const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`);
	const out = panel([
		{ key: "below", placement: "belowEditor", lines: ["BELOW"] },
		{ key: "above", placement: "aboveEditor", lines },
	]);
	expect(out).toContain("line 9");
	expect(out).not.toContain("line 10");
	expect(out).toContain("… (widget truncated)");
	expect(out.indexOf("line 0")).toBeLessThan(out.indexOf("BELOW"));
	expect(panel([])).toBe("");
});
