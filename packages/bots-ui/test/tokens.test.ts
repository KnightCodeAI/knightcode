import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tokensCss } from "../src/tokens/css.ts";
import { colors } from "../src/tokens/tokens.ts";

it("keeps tokens.css in step with tokens.ts (run `bun run tokens` after editing tokens)", () => {
	expect(readFileSync(new URL("../src/tokens/tokens.css", import.meta.url), "utf8")).toBe(tokensCss());
});

it("defines every colour for both themes", () => {
	expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
	const css = tokensCss();
	for (const name of Object.keys(colors.dark))
		expect(css).toContain(`--kb-color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:`);
});
