import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@knightcode/agent";
import { type TUI, visibleWidth } from "@knightcode/tui";
import { describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import {
	getEditorTheme,
	initTheme,
	loadThemeFromPath,
	setThemeJsonValidator,
} from "../src/modes/interactive/theme/theme.ts";
import { validateThemeJson } from "../src/modes/interactive/theme/theme-schema.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

setThemeJsonValidator(validateThemeJson);

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function createContext() {
	const ui = { requestRender: vi.fn(), terminal: { rows: 24 } } as unknown as TUI;
	return {
		session: { thinkingLevel: "off" as ThinkingLevel, model: { reasoning: true } },
		editor: new CustomEditor(ui, getEditorTheme(), KeybindingsManager.create()),
		isBashMode: false,
		activeStatusIndicator: undefined,
		ui,
	};
}

const { updateEditorBorderColor } = InteractiveMode.prototype as unknown as {
	updateEditorBorderColor(this: ReturnType<typeof createContext>): void;
};

const borders = (context: ReturnType<typeof createContext>) => {
	const lines = context.editor.render(40);
	return [lines[0], lines.at(-1)];
};

describe("editor border", () => {
	it.each([1, 4, 40])("uses the original border characters without changing height at width %s", (width) => {
		initTheme("dark");
		const { editor } = createContext();
		editor.setText("─");
		const lines = editor.render(width);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe(getEditorTheme().borderColor("─".repeat(width)));
		expect(lines.at(-1)).toBe(getEditorTheme().borderColor("─".repeat(width)));
		expect(stripAnsi(lines[1]!)).toContain("─");
	});

	it("keeps the original border characters and scroll labels when content overflows", () => {
		initTheme("dark");
		const { editor } = createContext();
		editor.setText(Array.from({ length: 12 }, () => "line").join("\n"));
		const scrolledDown = editor.render(40);
		expect(stripAnsi(scrolledDown[0]!)).toContain("↑ 5 more");
		for (let index = 0; index < 11; index++) editor.handleInput("\x1b[A");
		const scrolledUp = editor.render(40);
		expect(stripAnsi(scrolledUp.at(-1)!)).toContain("↓ 5 more");
		for (const lines of [scrolledDown, scrolledUp]) {
			for (const border of [lines[0]!, lines.at(-1)!]) {
				expect(stripAnsi(border)).toContain("─");
				expect(stripAnsi(border)).not.toContain("━");
				expect(visibleWidth(border)).toBe(40);
			}
		}
	});

	it.each(["dark", "light", "system"])("is the same at every thinking level in %s", (name) => {
		initTheme(name);
		const context = createContext();
		const initial = borders(context);
		for (const level of THINKING_LEVELS) {
			context.session.thinkingLevel = level;
			updateEditorBorderColor.call(context);
			expect(borders(context), level).toEqual(initial);
		}
	});

	it("keeps shell mode distinct", () => {
		initTheme("dark");
		const context = createContext();
		const normal = borders(context);
		context.isBashMode = true;
		updateEditorBorderColor.call(context);
		expect(borders(context)).not.toEqual(normal);
		context.isBashMode = false;
		updateEditorBorderColor.call(context);
		expect(borders(context)).toEqual(normal);
	});

	it("still loads custom themes that define the old thinking border colors", () => {
		const dir = mkdtempSync(join(tmpdir(), "knightcode-legacy-theme-"));
		try {
			const json = JSON.parse(
				readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf8"),
			) as { name: string; colors: Record<string, string> };
			json.name = "legacy";
			json.colors.thinkingOff = "#4a443e";
			json.colors.thinkingHigh = "#ff8a3d";
			const path = join(dir, "legacy.json");
			writeFileSync(path, JSON.stringify(json));
			expect(loadThemeFromPath(path).getEditorBorderColor()("x")).toContain("x");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
