import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkExtensionSource, checkExtensionImports } from "../../scripts/check-extension-imports.ts";

const root = "/repo/builtins/feedback";
const file = `${root}/index.tsx`;

test("extension imports allow only the SDK, shared runtimes and files inside the same built-in", () => {
	for (const name of [
		"@knightcodeai/cli/desktop",
		"@knightcodeai/cli/desktop-backend",
		"react",
		"react-dom",
		"react/jsx-runtime",
		"radix-ui",
		"@pierre/diffs",
		"@pierre/trees",
		"typebox",
		"./view.tsx",
	])
		expect(checkExtensionSource(file, `import x from ${JSON.stringify(name)};`, root)).toEqual([]);
	for (const name of [
		"../other/index.ts",
		"../../store.ts",
		"@knightcodeai/cli",
		"@knightcode/ai",
		"node:fs",
		"/repo/store.ts",
		"react/private",
	])
		expect(checkExtensionSource(file, `export * from ${JSON.stringify(name)};`, root)).toHaveLength(1);
});

test("type imports, reexports, import-equals, require and computed dynamic imports cannot bypass the lint", () => {
	for (const source of [
		'import type { State } from "../../store.ts";',
		'export type { State } from "../../store.ts";',
		'type State = import("../../store.ts").State;',
		'import state = require("../../store.ts");',
		'const state = require("../../store.ts");',
		'const state = import("../../store.ts");',
		"const state = import(name);",
	])
		expect(checkExtensionSource(file, source, root), source).not.toEqual([]);
	expect(checkExtensionSource(file, '// import x from "../../store.ts";\nconst text = "import nope";', root)).toEqual(
		[],
	);
});

test("standalone extension files cannot import a different extension beside them", () => {
	const repo = mkdtempSync(join(tmpdir(), "kc-extension-imports-"));
	try {
		const builtins = join(repo, "apps", "desktop", "src", "renderer", "builtins");
		mkdirSync(join(builtins, "other"), { recursive: true });
		writeFileSync(join(builtins, "standalone.ts"), 'import "./other/index.ts";');
		writeFileSync(join(builtins, "other", "index.ts"), "export const value = 1;");
		expect(checkExtensionImports(repo)).toEqual([expect.stringContaining("unsupported import")]);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the migrated built-ins and shipped examples pass the real import audit", () => {
	expect(checkExtensionImports()).toEqual([]);
});

test("settings and appearance pages live in built-ins; host code keeps only recovery and trust surfaces", () => {
	const renderer = join(__dirname, "../../src/renderer");
	expect(existsSync(join(renderer, "components/settings.tsx"))).toBe(false);
	// Host files that may still draw settings UI: native extension recovery and its notices.
	const hostSettings = readdirSync(join(renderer, "extensions")).filter((name) =>
		/function \w+Settings\b|<Card |PageHeader/.test(readFileSync(join(renderer, "extensions", name), "utf8")),
	);
	expect(hostSettings.toSorted()).toEqual(["settings-host.tsx", "settings.tsx"]);
	expect(readdirSync(join(renderer, "builtins/settings")).toSorted()).toEqual(
		[
			"about.tsx",
			"appearance.tsx",
			"archived.tsx",
			"configuration.tsx",
			"general.tsx",
			"index.tsx",
			"mcp.tsx",
			"models.tsx",
			"plugins.tsx",
			"resources.tsx",
			"shortcuts.tsx",
			"ui.tsx",
			"worktrees.tsx",
		].toSorted(),
	);
});
