import { beforeAll, describe, expect, it } from "vitest";
import { renderDiff } from "../src/modes/interactive/components/diff.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("renderDiff", () => {
	beforeAll(() => initTheme("dark"));

	it.each([
		{
			name: "text is inserted at the start of a line",
			diff: "-83   await commitRecordingChunk({\n+83   const result = await commitRecordingChunk({",
			expected: ["-83   await commitRecordingChunk({", "+83   const result = await commitRecordingChunk({"],
		},
		{
			name: "indented text is replaced",
			diff: "-12     const value = oldValue\n+12     const value = newValue",
			expected: ["-12     const value = oldValue", "+12     const value = newValue"],
		},
	])("preserves indentation when $name", ({ diff, expected }) => {
		const rendered = stripAnsi(renderDiff(diff, 120).join("\n"));

		for (const line of expected) {
			const match = /^([+-])(\d+) (.*)$/.exec(line);
			if (!match) throw new Error(`unparsed diff line: ${line}`);
			expect(rendered).toContain(`${match[2]} ${match[1]}${match[3]}`);
		}
	});

	it("does not highlight shared indentation as an insertion", () => {
		const rendered = renderDiff(
			"-83   await commitRecordingChunk({\n+83   const result = await commitRecordingChunk({",
			120,
		).join("\n");
		const added = rendered.split("\n")[1] ?? "";
		const at = added.indexOf("const result = ");

		expect(stripAnsi(rendered)).toContain("83 +  const result = await commitRecordingChunk({");
		expect(at).toBeGreaterThan(2);
		// A highlight that swallowed the indent would leave those spaces immediately in front of the word.
		expect(added.slice(at - 2, at)).not.toBe("  ");
	});
});
