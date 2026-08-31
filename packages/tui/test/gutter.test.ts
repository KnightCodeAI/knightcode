import assert from "node:assert";
import { describe, it } from "node:test";
import { Gutter } from "../src/components/gutter.ts";
import { Text } from "../src/components/text.ts";
import { encodeKitty } from "../src/terminal-image.ts";
import type { Component } from "../src/tui.ts";

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
