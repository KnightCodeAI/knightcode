import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../../src/renderer/styles.css"), "utf8");

type Rgba = [number, number, number, number];

/** A token as RGBA: `#rrggbb` or `rgb(r g b / a)`; other values (color-mix, var) are skipped. */
function parse(value: string): Rgba | undefined {
	const hex = /^#([0-9a-f]{6})$/i.exec(value);
	if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
	const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
	return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : undefined;
}

function tokens(selector: string): Record<string, Rgba> {
	const start = css.indexOf(selector);
	const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
	const entries = [...body.matchAll(/(--kc-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, parse(m[2]!.trim())] as const);
	return Object.fromEntries(entries.filter((e): e is readonly [string, Rgba] => e[1] !== undefined));
}

/** A translucent colour as it shows over an opaque one. */
const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
	r * a + br * (1 - a),
	g * a + bg * (1 - a),
	b * a + bb * (1 - a),
	1,
];

function luminance([r, g, b]: Rgba): number {
	const [lr, lg, lb] = [r, g, b].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

const contrast = (text: Rgba, surface: Rgba) => {
	const [hi, lo] = [luminance(over(text, surface)), luminance(surface)].sort((x, y) => y - x);
	return (hi! + 0.05) / (lo! + 0.05);
};

// desktop-shell.md section 16: text meets WCAG AA (4.5:1) and secondary and tertiary text 3:1 on every surface it
// sits on.
for (const [name, selector] of [
	["dark", '\n[data-theme="dark"]'],
	["light", '\n[data-theme="light"]'],
] as const) {
	test(`${name} theme text contrast`, () => {
		const t = tokens(selector);
		for (const surface of [
			"--kc-bg-surface",
			"--kc-bg-sidebar",
			"--kc-bg-composer",
			"--kc-bg-section",
			"--kc-bg-panel",
		]) {
			expect(contrast(t["--kc-text"]!, t[surface]!), `text on ${surface}`).toBeGreaterThanOrEqual(4.5);
			expect(contrast(t["--kc-text-secondary"]!, t[surface]!), `secondary on ${surface}`).toBeGreaterThanOrEqual(3);
			expect(contrast(t["--kc-text-tertiary"]!, t[surface]!), `tertiary on ${surface}`).toBeGreaterThanOrEqual(3);
		}
		expect(contrast(t["--kc-text-on-accent"]!, t["--kc-accent"]!), "text on accent").toBeGreaterThanOrEqual(4.5);
		// Full access in menus, and the button that confirms it.
		expect(contrast(t["--kc-caution"]!, t["--kc-bg-panel"]!), "caution on panel").toBeGreaterThanOrEqual(4.5);
		expect(contrast(t["--kc-text-on-accent"]!, t["--kc-caution"]!), "text on caution").toBeGreaterThanOrEqual(4.5);
	});
}
