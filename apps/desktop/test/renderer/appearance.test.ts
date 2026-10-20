import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BASE, customTokens, fontFaces, parseThemeString, themeString } from "../../src/renderer/appearance.ts";

const css = readFileSync(join(import.meta.dirname, "../../src/renderer/styles.css"), "utf8");

/** A theme block's colour tokens from styles.css as [r, g, b, a]. */
function builtIn(selector: string): Record<string, number[]> {
	const start = css.indexOf(selector);
	const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
	const out: Record<string, number[]> = {};
	for (const [, name, value] of body.matchAll(/(--kc-[\w-]+):\s*([^;]+);/g)) {
		const rgb = parse(value!.trim());
		if (rgb) out[name!] = rgb;
	}
	return out;
}

function parse(value: string): number[] | undefined {
	const hex = /^#([0-9a-f]{6})$/i.exec(value);
	if (hex) return [...[0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)), 1];
	const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
	return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : undefined;
}

// section 11.1: the palette derives from background and foreground; derived from the built-in pair it must be the
// built-in palette, or customizing one colour would shift every other.
for (const [theme, selector] of [
	["dark", '\n[data-theme="dark"]'],
	["light", '\n[data-theme="light"]'],
] as const) {
	test(`the ${theme} palette derived from its own colours is the built-in one`, () => {
		const expected = builtIn(selector);
		const derived = customTokens(theme, { background: BASE[theme].background, foreground: BASE[theme].foreground });
		const compared = Object.entries(derived).filter(([name]) => expected[name]);
		expect(compared.length).toBeGreaterThan(30);
		for (const [name, value] of compared) {
			const got = parse(value)!;
			const want = expected[name]!;
			// Light text is rgb(26 28 31); its derivation steps from white toward that, so allow a few units.
			for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!), `${name} channel ${i}`).toBeLessThanOrEqual(6);
			expect(got[3], `${name} alpha`).toBeCloseTo(want[3]!, 2);
		}
	});
}

test("a theme string round-trips and rejects anything else", () => {
	const custom = { accent: "#3566f0", background: "#101010", foreground: "#eeeeee", font: "Cascadia Code" };
	expect(parseThemeString(themeString(custom))).toEqual(custom);
	expect(parseThemeString('knightcode-theme-v1:{"accent":"red","font":""}')).toEqual({});
	expect(parseThemeString("codex-theme-v1:{}")).toBeUndefined();
	expect(parseThemeString("knightcode-theme-v1:{not json")).toBeUndefined();
});

test("nothing is derived until something is customized; an accent alone sets only the accent tokens", () => {
	expect(customTokens("dark", undefined)).toEqual({});
	expect(Object.keys(customTokens("dark", { accent: "#3566f0" })).sort()).toEqual([
		"--kc-accent",
		"--kc-accent-hover",
		"--kc-focus",
		"--kc-info",
		"--kc-info-bg",
		"--kc-link",
		"--kc-selection",
		"--kc-switch-on",
		"--kc-text-on-accent",
		"--kc-user-bubble",
		"--kc-user-bubble-text",
	]);
});

// The built-in accent shades are the default accent's (KnightCode's orange); chosen again, it must draw them again.
for (const [theme, selector] of [
	["dark", '\n[data-theme="dark"]'],
	["light", '\n[data-theme="light"]'],
] as const) {
	test(`the ${theme} default accent derives the built-in accent shades`, () => {
		const expected = builtIn(selector);
		const derived = Object.entries(customTokens(theme, { accent: BASE[theme].accent })).filter(
			([name]) => !/^--kc-(accent|text-on-accent)/.test(name),
		);
		expect(derived.length).toBe(8);
		for (const [name, value] of derived) {
			const got = parse(value)!;
			const want = expected[name]!;
			for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!), `${name} channel ${i}`).toBeLessThanOrEqual(6);
			expect(got[3], `${name} alpha`).toBeCloseTo(want[3]!, 2);
		}
	});
}

test("contrast scales how far surfaces step from the background; the default changes nothing", () => {
	const plain = customTokens("dark", { background: "#181818" });
	expect(customTokens("dark", { background: "#181818", contrast: 60 })).toEqual(plain);
	const flat = customTokens("dark", { contrast: 0 });
	expect(flat["--kc-bg-shell"]).toBe("rgb(24 24 24)");
	expect(flat["--kc-text"]).toBe(plain["--kc-text"]);
});

test("a chosen font face is named by an @font-face alias ahead of its family", () => {
	const custom = { font: "Cascadia Code", fontStyle: "CascadiaCode-Bold", codeFont: "Consolas" };
	expect(customTokens("dark", custom)["--kc-font-ui"]).toMatch(/^"kc-ui-face", "Cascadia Code", /);
	expect(customTokens("dark", custom)["--kc-font-code"]).toMatch(/^"Consolas", ui-monospace/);
	expect(fontFaces(custom)).toBe('@font-face { font-family: "kc-ui-face"; src: local("CascadiaCode-Bold"); }');
});
