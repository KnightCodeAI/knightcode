import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@knightcode/agent";
import type { TUI } from "@knightcode/tui";
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
import { validateThemeJson } from "../src/modes/interactive/theme/theme-json.ts";

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
