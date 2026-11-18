import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateDesktopModels } from "../scripts/desktop-models.ts";
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
	it("publishes the backend without losing its opaque context brand or importing renderer code", () => {
		const source = readFileSync(new URL("../src/desktop-backend.ts", import.meta.url), "utf8");
		const generated = generateDesktopApi(source, "backend");
		expect(generated.declarations).toContain("declare const backendDataContext: unique symbol");
		expect(generated.declarations).toContain("experimental_context");
		expect(generated.inventory).toContain("experimental_DesktopBackendApp.experimental_registerRpc");
		expect(generated.declarations).not.toContain("react");
	});

	it("type-checks portable backend declarations outside the checkout, including opaque contexts and exact setters", () => {
		const root = mkdtempSync(join(tmpdir(), "kc-backend-portable-"));
		try {
			cpSync(join(getDocsPath(), "desktop-backend-sdk.d.ts"), join(root, "desktop-backend-sdk.d.ts"));
			writeFileSync(
				join(root, "consumer.ts"),
				`import { experimental_defineDesktopBackend, type experimental_BackendDataContext } from "./desktop-backend-sdk";
import { Type } from "typebox";
// @ts-expect-error contexts require the host's private brand
const forged: experimental_BackendDataContext = { scope: "app" };
experimental_defineDesktopBackend(app => {
 const count = app.experimental_storage({ id: "count", schema: Type.Number() });
 count.experimental_set(1);
 // @ts-expect-error setters do not accept absent or invalid values
 count.experimental_set("wrong");
 app.experimental_registerRpc({ id: "read", kind: "read", params: Type.Null(), result: Type.Number(), experimental_handle: () => count.experimental_get() ?? 0 });
});`,
			);
			writeFileSync(
				join(root, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						noEmit: true,
						strict: true,
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "Bundler",
						types: [],
						paths: { typebox: [fileURLToPath(import.meta.resolve("typebox")).replace(/index\.mjs$/, "index.d.mts")] },
					},
					include: ["./consumer.ts"],
				}),
			);
			const compiler = join(dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))), "bin/tsc");
			const result = spawnSync(process.execPath, [compiler, "-p", join(root, "tsconfig.json")], {
				encoding: "utf8",
				timeout: 30_000,
			});
			expect(result.error).toBeUndefined();
			expect(result.stdout + result.stderr).toBe("");
			expect(result.status).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ships current inventory, declarations, guide, and skill together", () => {
		const source = readFileSync(new URL("../src/desktop.ts", import.meta.url), "utf8");
		const generated = generateDesktopApi(source);
		expect(readFileSync(join(getDocsPath(), "desktop-models.ts"), "utf8")).toBe(generateDesktopModels());
		expect(readFileSync(new URL("../src/desktop-models.ts", import.meta.url), "utf8")).toBe(generateDesktopModels());
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
			cpSync(new URL("src/desktop-backend.ts", source), join(root, "src/desktop-backend.ts"));
			cpSync(new URL("src/desktop-models.ts", source), join(root, "src/desktop-models.ts"));
			for (const file of [
				"desktop-extensions.md",
				"desktop-api.md",
				"desktop-sdk.d.ts",
				"desktop-models.ts",
				"desktop-backend-api.md",
				"desktop-backend-sdk.d.ts",
			])
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
