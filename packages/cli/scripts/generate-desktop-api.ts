/** Regenerate or verify shipped API assets, module graphs and reference-example types. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageDesktopExtension } from "../src/app-server/desktop-extensions/artifacts.ts";
import { checkDesktopDocumentation, generateDesktopApi } from "./desktop-api.ts";
import { generateDesktopModels } from "./desktop-models.ts";

/** Fail packaging on stale API assets, undocumented surfaces, or invalid shipped examples. */
export async function checkDesktopExtensionAssets(
	root = fileURLToPath(new URL("../", import.meta.url)),
): Promise<void> {
	const models = generateDesktopModels();
	for (const file of ["src/desktop-models.ts", "docs/desktop-models.ts"])
		if (readFileSync(join(root, file), "utf8") !== models)
			throw new Error(`Stale desktop read models ${file}; regenerate desktop API assets.`);
	const api = generateDesktopApi(readFileSync(join(root, "src/desktop.ts"), "utf8"));
	checkDesktopDocumentation(api, readFileSync(join(root, "docs/desktop-extensions.md"), "utf8"));
	for (const [file, content] of [
		["desktop-api.md", api.inventory],
		["desktop-sdk.d.ts", api.declarations],
	]) {
		if (readFileSync(join(root, "docs", file!), "utf8") !== content)
			throw new Error(`Stale desktop API asset ${file}; run bun packages/cli/scripts/generate-desktop-api.ts.`);
	}
	const backend = generateDesktopApi(readFileSync(join(root, "src/desktop-backend.ts"), "utf8"), "backend");
	for (const [file, content] of [
		["desktop-backend-api.md", backend.inventory],
		["desktop-backend-sdk.d.ts", backend.declarations],
	])
		if (readFileSync(join(root, "docs", file!), "utf8") !== content)
			throw new Error(`Stale desktop backend API asset ${file}; regenerate desktop API assets.`);
	const cache = mkdtempSync(join(tmpdir(), "kc-desktop-examples-"));
	try {
		const examples = join(root, "examples/desktop-extensions");
		for (const entry of readdirSync(examples, { withFileTypes: true }))
			if (entry.isDirectory()) await stageDesktopExtension(join(examples, entry.name), cache, entry.name);
	} finally {
		rmSync(cache, { recursive: true, force: true });
	}
	const compiler = join(dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))), "bin/tsc");
	const checked = spawnSync(
		process.execPath,
		[compiler, "--noEmit", "--project", join(root, "examples/desktop-extensions/tsconfig.json")],
		{ encoding: "utf8" },
	);
	if (checked.error) throw checked.error;
	if (checked.status !== 0)
		throw new Error(`Desktop reference examples failed type checking:\n${checked.stdout}${checked.stderr}`);
}

if (import.meta.main) {
	if (!process.argv.includes("--check")) {
		const root = fileURLToPath(new URL("../", import.meta.url));
		const models = generateDesktopModels();
		writeFileSync(join(root, "src/desktop-models.ts"), models);
		writeFileSync(join(root, "docs/desktop-models.ts"), models);
		const api = generateDesktopApi(readFileSync(join(root, "src/desktop.ts"), "utf8"));
		writeFileSync(join(root, "docs/desktop-api.md"), api.inventory);
		writeFileSync(join(root, "docs/desktop-sdk.d.ts"), api.declarations);
		const backend = generateDesktopApi(readFileSync(join(root, "src/desktop-backend.ts"), "utf8"), "backend");
		writeFileSync(join(root, "docs/desktop-backend-api.md"), backend.inventory);
		writeFileSync(join(root, "docs/desktop-backend-sdk.d.ts"), backend.declarations);
	}
	await checkDesktopExtensionAssets();
	console.log("Desktop API assets and external examples validated.");
}
