import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	BASE,
	customTokens,
	fontFaces,
	freebuffTokens,
	isHex,
	parseThemeString,
	renderGradientOverlay,
	renderSourceGradient,
	THEME_PRESETS,
	themeString,
} from "../../src/renderer/appearance.ts";

const css = readFileSync(join(import.meta.dirname, "../../src/renderer/styles.css"), "utf8");

/** A theme block's colour tokens from styles.css as [r, g, b, a]. */
function builtIn(selector: string): Record<string, number[]> {
	const start = css.indexOf(selector);
	if (start === -1) throw new Error(`no ${JSON.stringify(selector)} block in styles.css`);
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
	// An imported face cannot end its CSS string and add rules of its own.
	const hostile = parseThemeString(
		`knightcode-theme-v1:${JSON.stringify({ font: "A", fontStyle: 'X"\\\n} .kc-button { display: none } @font-face {' })}`,
	);
	expect(fontFaces(hostile)).toBe(
		'@font-face { font-family: "kc-ui-face"; src: local("X} .kc-button { display: none } @font-face {"); }',
	);
});

test("theme presets are well-formed and valid", () => {
	expect(THEME_PRESETS.length).toBe(28);
	const ids = new Set(THEME_PRESETS.map((p) => p.id));
	expect(ids.size).toBe(28);

	const builtins = THEME_PRESETS.filter((p) => p.builtin);
	expect(builtins.map((p) => p.id)).toEqual(["auto", "dark", "light"]);

	const downloadable = THEME_PRESETS.filter((p) => !p.builtin);
	expect(downloadable.length).toBe(25);

	for (const preset of THEME_PRESETS) {
		expect(["dark", "light", "system"]).toContain(preset.mode);
		expect(preset.name.length).toBeGreaterThan(0);
		expect(preset.description.length).toBeGreaterThan(0);
		expect(preset.dots.length).toBe(4);
		for (const dot of preset.dots) {
			expect(isHex(dot)).toBe(true);
		}
		if (preset.customization.background) expect(isHex(preset.customization.background)).toBe(true);
		if (preset.customization.foreground) expect(isHex(preset.customization.foreground)).toBe(true);
		if (preset.customization.accent) expect(isHex(preset.customization.accent)).toBe(true);
	}
});

test("freebuffTokens derives tokens for wallpaper preset (Alpine)", () => {
	const alpine = THEME_PRESETS.find((p) => p.id === "alpine")!;
	expect(alpine).toBeDefined();
	const tokens = freebuffTokens(alpine);
	expect(tokens["--kc-accent"]).toBe(alpine.colors.accent);
	expect(tokens["--kc-text"]).toBe(alpine.colors.text);
	expect(tokens["--kc-bg-shell"]).toBe("transparent");
	expect(tokens["--wallpaper-opacity"]).toBe("72%");
	expect(tokens["--wallpaper-blur"]).toBe("8px");
	expect(tokens["--kc-user-bubble"]).toBe(alpine.colors.accent);
	expect(tokens["--kc-user-bubble-text"]).toBe("#ffffff");
});

test("freebuffTokens derives solid tokens for non-wallpaper preset (OG Shine)", () => {
	const shine = THEME_PRESETS.find((p) => p.id === "og-shine")!;
	expect(shine).toBeDefined();
	const tokens = freebuffTokens(shine);
	expect(tokens["--kc-accent"]).toBe("#50ecb3");
	expect(tokens["--kc-bg-shell"]).not.toBe("transparent");
});

test("freebuffTokens dynamically adapts the System preset for dark and light modes", () => {
	const system = THEME_PRESETS.find((p) => p.id === "auto")!;
	expect(system).toBeDefined();
	const darkTokens = freebuffTokens(system, "dark");
	expect(darkTokens["--kc-accent"]).toBe("#f97316");
	expect(darkTokens["--kc-user-bubble"]).toBe("#f97316");
	expect(darkTokens["--kc-text"]).toBe("#ffffff");

	const lightTokens = freebuffTokens(system, "light");
	expect(lightTokens["--kc-accent"]).toBe("#ea580c");
	expect(lightTokens["--kc-user-bubble"]).toBe("#ea580c");
	expect(lightTokens["--kc-text"]).toBe("#1a1c1f");
});

test("gradient rendering helpers handle linear, radial, mesh and overlays", () => {
	expect(renderSourceGradient("gradient:linear:#111111,#222222,#333333")).toContain("linear-gradient");
	expect(renderSourceGradient("gradient:radial:#111111,#222222,#333333")).toContain("radial-gradient");
	expect(renderSourceGradient("gradient:mesh:#111111,#222222,#333333")).toContain("radial-gradient");
	const overlay = renderGradientOverlay("#152423", { enabled: true, direction: "bottom", position: 0.66 });
	expect(overlay).toContain("linear-gradient(to top");
	expect(overlay).toContain("#15242300");
	expect(overlay).toContain("#152423ff");
});
