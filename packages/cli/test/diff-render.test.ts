import { visibleWidth } from "@knightcode/tui";
import { beforeAll, describe, expect, test } from "vitest";
import { generateDiffString } from "../src/core/tools/edit-diff.ts";
import { renderDiff } from "../src/modes/interactive/components/diff.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("renderDiff", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("lays out numbered rows, tints changes to the full width and wraps under the code", () => {
		const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n";
		const after = "a\nB is now a line long enough to wrap\nc\nd\ne\nf\ng\nh\ni\nj\nK\n";
		const lines = renderDiff(generateDiffString(before, after).diff, 30);
		const plain = lines.map((line) => stripAnsi(line).trimEnd());

		expect(plain).toEqual([
			" 1  a",
			" 2 -b",
			" 2 +B is now a line long",
			"    enough to wrap",
			" 3  c",
			" 4  d",
			" 5  e",
			"   ⋮",
			" 8  h",
			" 9  i",
			"10  j",
			"11 -k",
			"11 +K",
		]);
		for (const index of [1, 2, 3, 11, 12]) {
			expect(visibleWidth(lines[index])).toBe(30);
			expect(lines[index]).toContain(theme.getBgAnsi(index === 1 || index === 11 ? "toolErrorBg" : "toolSuccessBg"));
		}
	});

	test("emphasizes changed words only when most of the line is unchanged", () => {
		const small = renderDiff(generateDiffString("const VERSION = 1;\n", "const VERSION = 2;\n").diff, 40);
		const large = renderDiff(generateDiffString("alpha\n", "omega\n").diff, 40);
		const tints = (line: string) => new Set(line.match(/\x1b\[48;[0-9;]*m/g));

		expect(tints(small[0]).size).toBe(2);
		expect(tints(small[1]).size).toBe(2);
		expect(tints(large[0]).size).toBe(1);
		expect(tints(large[1]).size).toBe(1);
	});
});
