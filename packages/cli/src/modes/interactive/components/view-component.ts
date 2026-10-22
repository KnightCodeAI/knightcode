import type { View } from "@knightcode/app-server-protocol";
import { type Component, Container, Gutter, HStack, Markdown, Text, VStack } from "@knightcode/tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const BAR_CELLS = 20;

/** A pipe table the markdown renderer lays out; a cell's `|` and line breaks would break its row. */
function markdownTable(columns: string[], rows: string[][]): string {
	const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
	const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
	return [row(columns), row(columns.map(() => "---")), ...rows.map(row)].join("\n");
}

function build(view: View): Component {
	switch (view.type) {
		case "text":
			return new Text(view.tone ? theme.fg(view.tone, view.text) : view.text, 0, 0);
		case "markdown":
			return new Markdown(view.markdown, 0, 0, getMarkdownTheme());
		case "stack":
			return view.direction === "horizontal"
				? new HStack(view.children.map(build), { gap: 2 })
				: new VStack(view.children.map(build));
		case "list":
			return new VStack(view.items.map((item) => new Gutter(build(item), "• ", "  ")));
		case "table":
			return new Markdown(markdownTable(view.columns, view.rows), 0, 0, getMarkdownTheme());
		case "progress": {
			const percent = Math.min(100, Math.round((view.value / view.max) * 100));
			const filled = Math.round((percent / 100) * BAR_CELLS);
			const bar = theme.fg("accent", "█".repeat(filled)) + theme.fg("muted", "░".repeat(BAR_CELLS - filled));
			return new Text(`${bar} ${view.label ? `${view.label} ` : ""}${percent}%`, 0, 0);
		}
		case "button":
			return new Text(theme.fg("accent", `[ ${view.label} ]`), 0, 0);
		case "field":
			if (view.kind === "toggle") return new Text(`${view.value ? "[x]" : "[ ]"} ${view.label}`, 0, 0);
			return new Text(`${view.label}: ${String(view.value)}${view.kind === "select" ? " ▾" : ""}`, 0, 0);
	}
}

/** A declarative view drawn with TUI components (D14). Controls are drawn, never focused. */
export class ViewComponent extends Container {
	private readonly view: View;

	constructor(view: View) {
		super();
		this.view = view;
		this.addChild(build(view));
	}

	/** Colours are baked into the children's text, so a theme change builds them again. */
	override invalidate(): void {
		this.clear();
		this.addChild(build(this.view));
	}
}
