import assert from "node:assert";
import { describe, it } from "node:test";
import { renderLatex } from "../src/index.ts";

const START = "\u{f0000}";
const END = "\u{f0001}";
const BR = "\\\\";

/**
 * Layout nodes are referenced by private-use placeholders that the layout pass resolves. A
 * branch that stores another node's text verbatim would pass a placeholder straight through
 * to the terminal: `renderMatrix` stores its cells as text, and `renderCases` returns a
 * marker for any multi-row body without checking whether it is nested, so those two together
 * are the shape to watch.
 *
 * Nested environments do not parse today, so no input here actually leaks — this pins the
 * invariant rather than covering a fixed bug. `renderLatex` also refuses outright if a marker
 * survives, which is why an `undefined` result counts as passing: that is the documented
 * "cannot render this" path and the caller falls back to the source.
 */
describe("layout markers never reach the output", () => {
	const sources = [
		`\\begin{cases}a & b${BR} c & d\\end{cases}`,
		`\\begin{cases}a & b${BR} c & d${BR} e & f\\end{cases}`,
		`\\begin{matrix} \\begin{cases}a & b${BR} c & d\\end{cases} & z${BR} e & f \\end{matrix}`,
		`\\begin{cases} \\begin{cases}p & q${BR} r & s\\end{cases} & outer${BR} t & u \\end{cases}`,
		`\\frac{\\begin{cases}a & b${BR} c & d\\end{cases}}{2}`,
		`\\begin{matrix} \\frac{1}{2} & b${BR} c & d \\end{matrix}`,
		`\\begin{pmatrix} \\frac{a+1}{b} & 2 \\end{pmatrix}`,
		`\\begin{matrix} x_i^{n+1} & \\sum_{i=0}^{n} i \\end{matrix}`,
		`\\begin{cases} \\frac{1}{2} & b${BR} c & d \\end{cases}`,
	];

	for (const display of [false, true]) {
		for (const source of sources) {
			it(`emits no marker for ${JSON.stringify(source)} (display=${display})`, () => {
				const out = renderLatex(source, { display });
				if (out === undefined) return;
				assert.ok(!out.includes(START), `start marker leaked: ${JSON.stringify(out)}`);
				assert.ok(!out.includes(END), `end marker leaked: ${JSON.stringify(out)}`);
			});
		}
	}
});
