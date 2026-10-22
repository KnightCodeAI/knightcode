import assert from "node:assert";
import { describe, it } from "node:test";
import { Gutter } from "../src/components/gutter.ts";
import { Text } from "../src/components/text.ts";
import { encodeKitty } from "../src/terminal-image.ts";
import type { Component } from "../src/tui.ts";
import { visibleWidth } from "../src/utils.ts";

function trimmed(lines: string[]): string[] {
	return lines.map((line) => line.trimEnd());
}

describe("Gutter", () => {
	it("prefixes the first line and indents continuations", () => {
		const gutter = new Gutter(new Text("hello world again", 0, 0), "> ", "  ");
		assert.deepStrictEqual(trimmed(gutter.render(13)), ["> hello world", "  again"]);
	});

	it("shrinks the child to leave room for the gutter", () => {
		const gutter = new Gutter(new Text("abcdefghij", 0, 0), "  ⎿  ", "     ");
		const lines = gutter.render(10);
		assert.deepStrictEqual(trimmed(lines), ["  ⎿  abcde", "     fghij"]);
		for (const line of lines) assert.strictEqual(line.length, 10);
	});

	it("never renders wider than the width when the prefix leaves no room", () => {
		// Nested list bullets in a narrow terminal: each level takes two columns.
		let component: Component = new Text("deep leaf text", 0, 0);
		for (let i = 0; i < 7; i++) component = new Gutter(component, "• ", "  ");
		for (const width of [1, 2, 5, 10, 13, 14, 15, 20]) {
			for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
		}
		// With room left, nothing is cut: the child wraps as before.
		assert.deepStrictEqual(trimmed(component.render(20)), [
			"• • • • • • • deep",
			"              leaf",
			"              text",
		]);
	});

	it("renders nothing when the child renders nothing", () => {
		const gutter = new Gutter(new Text("", 0, 0), "> ", "  ");
		assert.deepStrictEqual(gutter.render(20), []);
	});

	it("passes image lines through unprefixed", () => {
		const imageLine = encodeKitty("iVBORw0KGgo=", { imageId: 1 });
		const child: Component = {
			invalidate: () => {},
			render: () => ["first", imageLine],
		};
		const lines = new Gutter(child, "> ", "  ").render(20);
		assert.strictEqual(lines[0], "> first");
		assert.strictEqual(lines[1], imageLine);
	});

	it("recolors without rebuilding the child", () => {
		const gutter = new Gutter(new Text("x", 0, 0), "> ", "  ");
		gutter.setPrefixes("* ", "  ");
		assert.deepStrictEqual(trimmed(gutter.render(10)), ["* x"]);
	});
});
