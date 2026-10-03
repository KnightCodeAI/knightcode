import { type TUI, visibleWidth } from "@knightcode/tui";
import { describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { FramedEditor } from "../src/extensions/ui/index.ts";
import { WorkingStatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function editor(): FramedEditor {
	initTheme("dark");
	const tui = { requestRender: vi.fn(), terminal: { rows: 20 } } as unknown as TUI;
	return new FramedEditor(tui, getEditorTheme(), KeybindingsManager.create());
}

describe("ui extension editor frame", () => {
	it("draws a rounded frame at full width around every content row", () => {
		const framed = editor();
		framed.focused = true;
		framed.setText("hello\nworld");
		const lines = framed.render(20).map(stripAnsi);

		expect(lines[0]).toBe(`╭${"─".repeat(18)}╮`);
		expect(lines.at(-1)).toBe(`╰${"─".repeat(18)}╯`);
		for (const line of lines.slice(1, -1)) {
			expect(line.startsWith("│")).toBe(true);
			expect(line.endsWith("│")).toBe(true);
		}
		for (const line of framed.render(20)) expect(visibleWidth(line)).toBe(20);
	});

	it("keeps the rail when the cursor sits at the end of a full line", () => {
		const framed = editor();
		framed.focused = true;
		framed.setText("x".repeat(16));
		const lines = framed.render(20);
		for (const line of lines) expect(visibleWidth(line)).toBe(20);
		expect(stripAnsi(lines[1]!).endsWith("│")).toBe(true);
	});

	it("never drops padding below the rail column", () => {
		const framed = editor();
		framed.setPaddingX(0);
		expect(framed.getPaddingX()).toBe(2);
	});

	it("embeds the working status inside the rounded top border", () => {
		const framed = editor();
		const tui = { requestRender: vi.fn(), terminal: { rows: 20 } } as unknown as TUI;
		const indicator = new WorkingStatusIndicator(tui, "Working");
		framed.setWorkingStatusIndicator(indicator);
		const top = stripAnsi(framed.render(40)[0]!);
		expect(top.startsWith("╭── ")).toBe(true);
		expect(top).toContain("Working");
		expect(top.endsWith("╮")).toBe(true);
		expect(visibleWidth(top)).toBe(40);
		indicator.dispose();
	});

	it("falls back to plain rules when too narrow to frame", () => {
		const lines = editor().render(4).map(stripAnsi);
		expect(lines[0]).toBe("────");
	});
});
