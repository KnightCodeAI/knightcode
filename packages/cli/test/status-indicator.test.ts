import { type TUI, visibleWidth } from "@knightcode/tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import {
	IdleStatus,
	RetryStatusIndicator,
	WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { getEditorTheme, initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("status indicators", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps idle status at the same height as standalone status indicators", () => {
		const idleStatus = new IdleStatus();

		const lines = idleStatus.render(20);
		expect(lines).toHaveLength(2);
		expect(lines).toEqual([" ".repeat(20), " ".repeat(20)]);
	});

	it("keeps the top border unchanged unless the editor opts in", () => {
		initTheme("dark");
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());
		const indicator = new WorkingStatusIndicator(tui, "Working");
		editor.setWorkingStatusIndicator(indicator);

		expect(stripAnsi(editor.render(20)[0]!)).toBe("─".repeat(20));
		const standaloneLine = indicator.render(20)[1]!;
		expect(standaloneLine).toContain(theme.getFgAnsi("accent"));
		expect(standaloneLine).toContain(theme.getFgAnsi("muted"));
		indicator.dispose();
	});

	it("embeds the working indicator when the editor opts in", () => {
		initTheme("dark");
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		expect(editor.embedWorkingStatus).toBe(true);
		editor.borderColor = theme.getThinkingBorderColor("high");
		const indicator = new WorkingStatusIndicator(tui, "Working", undefined, () => editor.borderColor);
		editor.setWorkingStatusIndicator(indicator);

		const topBorder = editor.render(20)[0]!;
		expect(stripAnsi(topBorder)).toBe("── ⠋ Working ───────");
		expect(visibleWidth(topBorder)).toBe(20);
		expect(topBorder.split(theme.getFgAnsi("thinkingHigh"))).toHaveLength(5);
		indicator.dispose();
	});

	it("falls back to accent and muted when it is not embedded", () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		let embedded = true;
		const borderColor = theme.getThinkingBorderColor("high");
		const indicator = new WorkingStatusIndicator(tui, "Working", undefined, () => (embedded ? borderColor : undefined));

		expect(indicator.render(20)[1]!).toContain(theme.getFgAnsi("thinkingHigh"));

		// Demoted to the standalone row: the same live indicator must stop using the
		// border colour rather than keeping the one captured when it was created.
		embedded = false;
		indicator.invalidate();
		const standalone = indicator.render(20)[1]!;
		expect(standalone).toContain(theme.getFgAnsi("accent"));
		expect(standalone).toContain(theme.getFgAnsi("muted"));
		indicator.dispose();
	});

	it("keeps the message in the border when it fits but the overflow count does not", () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		const indicator = new WorkingStatusIndicator(tui, "Working");
		editor.setWorkingStatusIndicator(indicator);

		// 16 columns: "⠋ Working" fits alone, but not beside " ↑ 4 more ".
		const renderTopBorder = (editor as unknown as { renderTopBorder(width: number, hidden: number): string })
			.renderTopBorder;
		const topBorder = stripAnsi(renderTopBorder.call(editor, 16, 4));
		expect(topBorder).toBe("── ⠋ Working ───");
		expect(topBorder).not.toContain("more");
		indicator.dispose();
	});

	it("degrades to the bare glyph on a border too narrow for the message", () => {
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		const indicator = new WorkingStatusIndicator(tui, "Working");
		editor.setWorkingStatusIndicator(indicator);
		const renderTopBorder = (editor as unknown as { renderTopBorder(width: number, hidden: number): string })
			.renderTopBorder;

		// Wide enough for both, then the message alone. The message is rendered at
		// width - 5, exactly what the message-alone layout needs, so it wins at every
		// width that can hold it and the glyph is only reached below that.
		expect(stripAnsi(renderTopBorder.call(editor, 40, 4))).toBe("── ⠋ Working ── ↑ 4 more ───────────────");
		expect(stripAnsi(renderTopBorder.call(editor, 20, 4))).toBe("── ⠋ Working ───────");
		expect(stripAnsi(renderTopBorder.call(editor, 5, 4))).toBe("───⠋─");
		indicator.dispose();
	});

	it("disposes retry countdown updates", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const indicator = new RetryStatusIndicator(tui, 1, 3, 1000);
		const callsBeforeDispose = requestRender.mock.calls.length;

		indicator.dispose();
		vi.advanceTimersByTime(2000);

		expect(requestRender).toHaveBeenCalledTimes(callsBeforeDispose);
	});
});
