import { resetCapabilitiesCache, setCapabilities, type TUI, visibleWidth } from "@knightcode/tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { FramedEditor, KnightHeader } from "../src/extensions/ui/index.ts";
import { WorkingStatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import { getEditorTheme, getThemeByName, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("ui extension knight header", () => {
	afterEach(() => {
		vi.useRealTimers();
		resetCapabilitiesCache();
	});

	function header(trueColor: boolean) {
		vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
		setCapabilities({ images: null, trueColor, hyperlinks: false });
		initTheme("dark");
		const theme = getThemeByName("dark");
		if (!theme) throw new Error("dark theme not found");
		const tui = { requestRender: vi.fn(), viewportTop: 0 };
		const knight = new KnightHeader(tui as unknown as TUI, theme, "/work");
		// The animation clock advances per rendered frame, as it does under the real TUI.
		tui.requestRender.mockImplementation(() => void knight.render(80));
		return { tui, header: knight };
	}

	it("holds still through startup, then shimmers", () => {
		const { tui, header: knight } = header(true);
		const first = knight.render(80);
		vi.advanceTimersByTime(900);
		expect(tui.requestRender).not.toHaveBeenCalled();
		expect(knight.render(80)).toEqual(first);
		knight.dispose();
	});

	it("shimmers while on screen and freezes once scrolled off", () => {
		const { tui, header: knight } = header(true);
		const first = knight.render(80);
		vi.advanceTimersByTime(1200);
		expect(tui.requestRender).toHaveBeenCalled();
		const moved = knight.render(80);
		expect(moved).not.toEqual(first);
		expect(moved.map(stripAnsi)).toEqual(first.map(stripAnsi));

		// Rows above the viewport must not change, or regular mode clears the scrollback.
		tui.viewportTop = 3;
		tui.requestRender.mockClear();
		vi.advanceTimersByTime(1000);
		expect(tui.requestRender).not.toHaveBeenCalled();
		expect(knight.render(80)).toEqual(moved);
		knight.dispose();
	});

	it("stops after one glint", () => {
		const { tui, header: knight } = header(true);
		vi.advanceTimersByTime(3000);
		const done = knight.render(80);
		tui.requestRender.mockClear();
		vi.advanceTimersByTime(5000);
		expect(tui.requestRender).not.toHaveBeenCalled();
		expect(knight.render(80)).toEqual(done);
		knight.dispose();
	});

	it("stays still without truecolor", () => {
		const { tui, header: knight } = header(false);
		const first = knight.render(80);
		vi.advanceTimersByTime(1000);
		expect(tui.requestRender).not.toHaveBeenCalled();
		expect(knight.render(80)).toEqual(first);
		knight.dispose();
	});

	it("bands the knight by row without truecolor instead of checkering it", () => {
		const { header: knight } = header(false);
		// Narrow enough that the text stacks under the knight, leaving logo-only rows.
		for (const logo of knight.render(30).slice(1, 8)) {
			// One color for top halves, one for bottom halves.
			expect(new Set(logo.match(/\x1b\[38;5;\d+m/g) ?? []).size).toBeLessThanOrEqual(2);
			expect(new Set(logo.match(/\x1b\[48;5;\d+m/g) ?? []).size).toBeLessThanOrEqual(1);
		}
		knight.dispose();
	});

	it("fills full cells with background alone in macOS Terminal", () => {
		const { header: knight } = header(true);
		// "    ▄███████████": one lone half block, then full cells.
		const body = () => stripAnsi(knight.render(30)[4]!).trimEnd();
		vi.stubEnv("TERM_PROGRAM", "iTerm.app");
		expect(body()).toBe("     ▄▀▀▀▀▀▀▀▀▀▀▀");
		vi.stubEnv("TERM_PROGRAM", "Apple_Terminal");
		expect(body()).toBe("     ▄");
		expect(knight.render(30)[4]).toContain("\x1b[48;2;");
		vi.unstubAllEnvs();
		knight.dispose();
	});

	it("fits every width, stacking the text under the knight when narrow", () => {
		const { header: knight } = header(true);
		for (const width of [80, 30, 10]) {
			for (const line of knight.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(stripAnsi(knight.render(80)[2]!)).toContain("KnightCode");
		expect(stripAnsi(knight.render(30).find((line) => stripAnsi(line).includes("Knight")) ?? "")).not.toContain("▀");
		knight.dispose();
	});
});

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
