import { describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { UndoPicker } from "../src/extensions/undo/picker.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

initTheme("dark");

const rows = Array.from({ length: 25 }, (_, i) => ({
	id: `entry-${i}`,
	text: `message ${i}`,
	timestamp: new Date(2026, 0, 1, 12, i).toISOString(),
	files: 0,
	shellRan: false,
}));

function position(picker: UndoPicker): string | undefined {
	return /\((\d+\/\d+)\)/.exec(stripAnsi(picker.render(80).join("\n")))?.[1];
}

describe("UndoPicker", () => {
	it("pages the selection with PageUp/PageDown instead of leaving them to the fullscreen transcript", () => {
		let chosen: string | undefined;
		const picker = new UndoPicker(rows, new KeybindingsManager(), (id) => {
			chosen = id;
		});
		expect(picker.capturesViewportInput).toBe(true);
		expect(position(picker)).toBe("25/25");

		picker.handleInput("\x1b[5~");
		expect(position(picker)).toBe("15/25");
		picker.handleInput("\x1b[5~");
		picker.handleInput("\x1b[5~");
		expect(position(picker)).toBe("1/25");
		picker.handleInput("\x1b[6~");
		expect(position(picker)).toBe("11/25");

		picker.handleInput("\r");
		expect(chosen).toBe("entry-10");
	});
});
