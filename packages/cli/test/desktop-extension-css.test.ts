import { describe, expect, it } from "vitest";
import { scopeDesktopCss } from "../src/app-server/desktop-extensions/css.ts";
const options = { owner: "example", revision: "abc" };
describe("desktop CSS declaration policy", () => {
	it("namespaces globals and scopes roots through conditional rules", () => {
		const css = scopeDesktopCss(
			'@keyframes pulse {to {opacity: 0}} @property --local {syntax:"<color>"; inherits: false; initial-value: red} @layer buttons { @media (width > 20px) { :scope .label:hover::before { --local: blue; color: var(--local); animation: pulse 1s; font-family: Icon; } } } @font-face {font-family: Icon; src: url("./icon.woff2")}',
			{ ...options, asset: () => "app://ext/example/abc/icon.woff2" },
		);
		expect(css).toContain('@scope ([data-kc-owner="example"][data-kc-revision="abc"])');
		expect(css).toContain("--kc-example-abc-local");
		expect(css).toContain("animation: kc-example-abc-pulse 1s");
		expect(css).toContain("font-family: kc-example-abc-Icon");
		expect(css).toContain("@layer kc-example-abc-buttons");
	});
	it.each([
		"body {color:red}",
		":root {color:red}",
		"* {color:red}",
		":scope + button {color:red}",
		":scope:has(body) {color:red}",
		'@import "https://example.com/a.css";',
		'.x {background:url("https://example.com/x.png")}',
		".x {--kc-text:red}",
		".x {color:var(--kc-private)}",
		'@namespace x url("x");',
		".x { & .y {color:red} }",
	])("rejects escaping CSS: %s", (css) => {
		expect(() => scopeDesktopCss(css, options)).toThrow();
	});
	it("keeps CSS name spaces separate and matches font-family names without case sensitivity", () => {
		const css = scopeDesktopCss(
			'@layer print; @font-face {font-family: Icon; src:url("./icon.woff2")} @media print {.x {font-family:"icon"; animation:Icon 1s}}',
			{ ...options, asset: () => "app://ext/example/abc/icon.woff2" },
		);
		expect(css).toContain("@media print");
		expect(css).toContain('font-family:"kc-example-abc-Icon"');
		expect(css).toContain("animation:Icon 1s");
	});
	it("does not rename units or CSS function identifiers when rewriting global references", () => {
		const css = scopeDesktopCss(
			'@keyframes s {to {opacity:0}} @font-face {font-family:var;src:url("./font.woff2")} .x {animation:s 1s;font-family:var(--kc-font-ui)}',
			{ ...options, asset: () => "app://ext/example/abc/font.woff2" },
		);
		expect(css).toContain("animation:kc-example-abc-s 1s");
		expect(css).toContain("font-family:var(--kc-font-ui)");
	});
	it("normalizes case-insensitive declarations before isolating global names", () => {
		const css = scopeDesktopCss(
			'@font-face { FONT-FAMILY: Icon; SRC: url("./icon.woff2") } @keyframes pulse {to {opacity:0}} .x { FONT-FAMILY: Icon; ANIMATION-NAME: pulse }',
			{ ...options, asset: () => "app://ext/example/abc/icon.woff2" },
		);
		expect(css).toContain("font-family: kc-example-abc-Icon");
		expect(css).toContain("animation-name: kc-example-abc-pulse");
		expect(css).not.toContain("FONT-FAMILY: Icon");
	});
	it("does not rewrite literal strings or staged asset names as custom-property references", () => {
		const css = scopeDesktopCss('.x {content:"--literal REVISION";background:url("./--icon.png");color:var(--local)}', {
			...options,
			asset: () => "app://ext/example/abc/--icon.png",
		});
		expect(css).toContain('content:"--literal REVISION"');
		expect(css).toContain('url("app://ext/example/abc/--icon.png")');
		expect(css).toContain("var(--kc-example-abc-local)");
	});
	it("keeps published theme references read-only", () => {
		expect(scopeDesktopCss(":scope {color:var(--kc-text); font-family:var(--kc-font-ui)}", options)).toContain(
			"var(--kc-text)",
		);
	});
});
