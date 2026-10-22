/**
 * Desktop View - declarative views in a widget, answering presses, and in a tool result
 *
 * Shows a widget with a toggle and a button, drawn by the terminal and by the desktop app from the same data
 * (docs/declarative-views.md). In the desktop app the controls are live: a press reaches `ctx.ui.onViewEvent`, and
 * the extension answers by setting the widget again. The `check_summary` tool returns a table view, which both
 * clients draw in place of the tool's text output.
 *
 * Usage:
 *   knightcode --extension examples/extensions/desktop-view.ts
 */

import { Type } from "@knightcode/ai";
import { defineTool, type ExtensionAPI, type ExtensionContext, type View } from "@knightcodeai/cli";

const WIDGET = "desktop-view:checks";

const checkSummary = defineTool({
	name: "check_summary",
	label: "Check summary",
	description: "Summarize the project's checks as a table",
	parameters: Type.Object({}),
	async execute() {
		const view: View = {
			type: "table",
			columns: ["check", "result"],
			rows: [
				["types", "passed"],
				["tests", "2 failed"],
			],
		};
		return { content: [{ type: "text", text: "types: passed\ntests: 2 failed" }], details: { view } };
	},
});

export default function (knightcode: ExtensionAPI) {
	// Per session: the factory runs again for every thread that loads the extension.
	let verbose = false;
	let resets = 0;

	const show = (ctx: ExtensionContext) => {
		const view: View = {
			type: "stack",
			children: [
				{ type: "text", text: `Checks reset ${resets} time${resets === 1 ? "" : "s"}`, tone: "muted" },
				{
					type: "stack",
					direction: "horizontal",
					children: [
						{ type: "field", id: "verbose", kind: "toggle", label: "Verbose", value: verbose },
						{ type: "button", id: "reset", label: "Reset" },
					],
				},
			],
		};
		ctx.ui.setWidget(WIDGET, view);
	};

	knightcode.registerTool(checkSummary);

	knightcode.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		show(ctx);
		// Only where widgets are interactive (the desktop app); the terminal draws the controls as text.
		ctx.ui.onViewEvent?.((event) => {
			if (event.widgetKey !== WIDGET) return;
			if (event.id === "verbose" && typeof event.value === "boolean") verbose = event.value;
			if (event.id === "reset") resets++;
			show(ctx);
		});
	});
}
