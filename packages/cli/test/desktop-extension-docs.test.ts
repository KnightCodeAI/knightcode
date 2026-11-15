import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDesktopApi, checkDesktopDocumentation } from "../scripts/desktop-api.ts";
import { getDocsPath } from "../src/config.ts";
describe("desktop API publication contract", () => {
	it("generates portable declarations and inventories every public export and member", () => {
		const source =
			'import type { ReactNode } from "react";\nexport type experimental_Surface = "feedback" | "new-surface";\nexport interface App { register(): void; }\nexport function make(value: number = 1): App { return {} as App; }\nexport function defineDesktopExtension(options: { apiVersion: number } = { apiVersion: 2 }): App { return {} as App; }';
		const generated = generateDesktopApi(source);
		expect(generated.declarations).toContain("export declare function make(value?: number): App;");
		expect(generated.declarations).not.toContain("return");
		expect(generated.inventory).toContain("App.register");
		expect(generated.inventory).toContain("API version 2");
		expect(generated.surfaces).toEqual(["feedback", "new-surface"]);
		expect(() => checkDesktopDocumentation(generated, "<!-- surface: feedback -->")).toThrow(/new-surface/);
		expect(() =>
			checkDesktopDocumentation(generated, "API version 1\n<!-- surface: feedback -->\n<!-- surface: new-surface -->"),
		).toThrow(/API version 2/);
		expect(() =>
			checkDesktopDocumentation(generated, "API version 20\n<!-- surface: feedback -->\n<!-- surface: new-surface -->"),
		).toThrow(/API version 2/);
	});
	it("ships current inventory, declarations, guide, and skill together", () => {
		const source = readFileSync(new URL("../src/desktop.ts", import.meta.url), "utf8");
		const generated = generateDesktopApi(source);
		expect(readFileSync(join(getDocsPath(), "desktop-api.md"), "utf8")).toBe(generated.inventory);
		expect(readFileSync(join(getDocsPath(), "desktop-sdk.d.ts"), "utf8")).toBe(generated.declarations);
		const guide = readFileSync(join(getDocsPath(), "desktop-extensions.md"), "utf8");
		expect(() => checkDesktopDocumentation(generated, guide)).not.toThrow();
	});
	it("rejects type errors in otherwise stageable reference examples", () => {
		const root = mkdtempSync(join(tmpdir(), "kc-desktop-api-types-"));
		const source = new URL("../", import.meta.url);
		try {
			mkdirSync(join(root, "src"), { recursive: true });
			mkdirSync(join(root, "docs"));
			cpSync(new URL("src/desktop.ts", source), join(root, "src/desktop.ts"));
			for (const file of ["desktop-extensions.md", "desktop-api.md", "desktop-sdk.d.ts"])
				cpSync(new URL(`docs/${file}`, source), join(root, "docs", file));
			const examples = join(root, "examples/desktop-extensions");
			const example = join(examples, "semantic-error");
			cpSync(new URL("examples/desktop-extensions/08-owned-css", source), example, { recursive: true });
			writeFileSync(
				join(example, "app.tsx"),
				"const value: string = 1;\nexport default { setup() { void value; } };\n",
			);
			writeFileSync(
				join(examples, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: { noEmit: true, strict: true, types: [], jsx: "react-jsx" },
					include: ["**/*.tsx"],
				}),
			);
			const check = join(root, "check.ts");
			writeFileSync(
				check,
				`import { checkDesktopExtensionAssets } from ${JSON.stringify(new URL("scripts/generate-desktop-api.ts", source).href)};\nawait checkDesktopExtensionAssets(process.argv[2]);\n`,
			);
			const result = spawnSync("bun", [check, root], { encoding: "utf8", timeout: 30_000 });
			expect(result.error).toBeUndefined();
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("TS2322");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
