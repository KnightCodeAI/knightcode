import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../../src/renderer/styles.css"), "utf8");

function tokens(selector: string): Record<string, string> {
	const start = css.indexOf(selector);
	const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
	return Object.fromEntries([...body.matchAll(/(--kc-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi! + 0.05) / (lo! + 0.05);
};

// desktop-shell.md section 16: text meets WCAG AA (4.5:1) and muted text 3:1 on every surface it sits on.
for (const [name, selector] of [
	["dark", ':root[data-theme="dark"]'],
	["light", ':root[data-theme="light"]'],
] as const) {
	test(`${name} theme text contrast`, () => {
		const t = tokens(selector);
		for (const surface of ["--kc-bg-surface", "--kc-bg-sidebar", "--kc-bg-composer", "--kc-bg-selected"]) {
			expect(contrast(t["--kc-text"]!, t[surface]!), `text on ${surface}`).toBeGreaterThanOrEqual(4.5);
			expect(contrast(t["--kc-text-muted"]!, t[surface]!), `muted on ${surface}`).toBeGreaterThanOrEqual(3);
		}
		expect(contrast(t["--kc-text-on-accent"]!, t["--kc-accent"]!), "text on accent").toBeGreaterThanOrEqual(4.5);
		// Full access in menus, and the button that confirms it.
		expect(contrast(t["--kc-caution"]!, t["--kc-bg-panel"]!), "caution on panel").toBeGreaterThanOrEqual(4.5);
		expect(contrast(t["--kc-text-on-accent"]!, t["--kc-caution"]!), "text on caution").toBeGreaterThanOrEqual(4.5);
	});
}
