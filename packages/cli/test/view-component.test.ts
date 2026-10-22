import type { View } from "@knightcode/app-server-protocol";
import { type Component, Container, TuiMainScreen, visibleWidth } from "@knightcode/tui";
import { Type } from "typebox";
import { beforeAll, describe, expect, test } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { CustomMessageComponent } from "../src/modes/interactive/components/custom-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ViewComponent } from "../src/modes/interactive/components/view-component.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ui = new TuiMainScreen(new VirtualTerminal(80, 24));
const table: View = { type: "table", columns: ["test", "result"], rows: [["parser | lexer", "failed\ntwice"]] };
const every: View = {
	type: "stack",
	children: [
		{ type: "text", text: "plain" },
		{ type: "text", text: "careful", tone: "warning" },
		{ type: "markdown", markdown: "**bold** words" },
		{
			type: "list",
			items: [
				{ type: "text", text: "first" },
				{ type: "text", text: "second" },
			],
		},
		table,
		{ type: "progress", value: 150, max: 100, label: "tests" },
		{ type: "progress", value: 1, max: 4 },
		{ type: "button", id: "reset", label: "Reset" },
		{ type: "field", id: "name", kind: "text", label: "Name", value: "Ada" },
		{ type: "field", id: "on", kind: "toggle", label: "Verbose", value: true },
		{ type: "field", id: "off", kind: "toggle", label: "Quiet", value: false },
		{ type: "field", id: "pick", kind: "select", label: "Mode", value: "fast", options: ["fast", "slow"] },
		{ type: "stack", direction: "horizontal", children: [table, table, table] },
	],
};

const plain = (component: Component, width = 80) => component.render(width).map((line) => stripAnsi(line));
const text = (component: Component, width = 80) => plain(component, width).join("\n");

beforeAll(() => {
	initTheme();
});

describe("ViewComponent", () => {
	test("draws every node type", () => {
		const out = text(new ViewComponent(every));
		for (const expected of [
			"plain",
			"careful",
			"bold words",
			"• first",
			"• second",
			"parser | lexer",
			"failed twice",
			"tests 100%",
			"25%",
			"[ Reset ]",
			"Name: Ada",
			"[x] Verbose",
			"[ ] Quiet",
			"Mode: fast ▾",
		]) {
			expect(out).toContain(expected);
		}
		expect(out).not.toContain("**");
		expect(out).toContain("█".repeat(20));
	});

	test("stays within the width", () => {
		for (const width of [20, 40, 80]) {
			for (const line of new ViewComponent(every).render(width)) {
				expect(visibleWidth(line), `${width}: ${stripAnsi(line)}`).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("view widgets in the terminal", () => {
	function fakeMode() {
		const fake = {
			ui,
			extensionWidgetsAbove: new Map<string, Component>(),
			extensionWidgetsBelow: new Map<string, Component>(),
			renderWidgets: () => {},
		};
		const set = (key: string, content: unknown, options?: { placement?: "aboveEditor" | "belowEditor" }) =>
			(
				InteractiveMode as unknown as {
					prototype: { setExtensionWidget: (this: typeof fake, ...args: unknown[]) => void };
				}
			).prototype.setExtensionWidget.call(fake, key, content, options);
		return { fake, set };
	}

	test("a view draws at its placement", () => {
		const { fake, set } = fakeMode();
		set("above", { type: "text", text: "over the editor" });
		set("below", table, { placement: "belowEditor" });
		expect(text(fake.extensionWidgetsAbove.get("above")!)).toContain("over the editor");
		expect(text(fake.extensionWidgetsBelow.get("below")!)).toContain("parser | lexer");
		expect(fake.extensionWidgetsAbove.has("below")).toBe(false);
	});

	test("an invalid view draws one warning line", () => {
		const { fake, set } = fakeMode();
		set("bad", { type: "table", columns: ["a", "b", "c"], rows: [["1", "2"]] });
		const lines = plain(fake.extensionWidgetsAbove.get("bad")!)
			.map((line) => line.trimEnd())
			.filter(Boolean);
		expect(lines).toEqual([" (invalid view: a table row has 2 cells for 3 columns)"]);
	});

	test("lines and factories still work", () => {
		const { fake, set } = fakeMode();
		set("lines", ["one", "two"]);
		const factory = new Container();
		set("factory", () => factory);
		expect(text(fake.extensionWidgetsAbove.get("lines")!)).toContain("two");
		expect(fake.extensionWidgetsAbove.get("factory")).toBe(factory);
	});
});

describe("views in the transcript", () => {
	const result = { content: [{ type: "text", text: "RAW OUTPUT" }], details: { view: table }, isError: false };

	test("a tool result's view replaces the raw output", () => {
		const component = new ToolExecutionComponent("checks", "id", {}, {}, undefined, ui, "/");
		component.updateResult(result);
		const out = text(component);
		expect(out).toContain("parser | lexer");
		expect(out).not.toContain("RAW OUTPUT");
	});

	test("an invalid view keeps the raw output", () => {
		const component = new ToolExecutionComponent("checks", "id", {}, {}, undefined, ui, "/");
		component.updateResult({ ...result, details: { view: { type: "script" } } });
		expect(text(component)).toContain("RAW OUTPUT");
	});

	test("renderResult wins over the view", () => {
		const tool: ToolDefinition = {
			name: "checks",
			label: "checks",
			description: "checks",
			parameters: Type.Any(),
			execute: async () => ({ content: [], details: {} }),
			renderResult: () => new ViewComponent({ type: "text", text: "OWN RENDERER" }),
		};
		const component = new ToolExecutionComponent("checks", "id", {}, {}, tool, ui, "/");
		component.updateResult(result);
		const out = text(component);
		expect(out).toContain("OWN RENDERER");
		expect(out).not.toContain("parser | lexer");
	});

	test("a custom message's view replaces its markdown", () => {
		const component = new CustomMessageComponent({
			role: "custom",
			customType: "checks",
			content: "MARKDOWN TEXT",
			display: true,
			details: { view: table },
			timestamp: 0,
		});
		const out = text(component);
		expect(out).toContain("● checks");
		expect(out).toContain("parser | lexer");
		expect(out).not.toContain("MARKDOWN TEXT");
	});
});
