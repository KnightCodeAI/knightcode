import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const durableOutputPath = join(tmpdir(), "knightcode-durable-browser-smoke.js");
const errorLogPath = join(tmpdir(), "knightcode-browser-smoke-errors.log");

function normalizePath(path) {
	return path.replaceAll("\\", "/");
}

function findInput(inputs, suffix) {
	return Object.keys(inputs).find((input) => {
		const normalized = normalizePath(input);
		return normalized === suffix || normalized.endsWith(`/${suffix}`);
	});
}

try {
	const durableBuild = await build({
		entryPoints: ["scripts/durable-browser-smoke-entry.ts"],
		bundle: true,
		platform: "browser",
		format: "esm",
		logLevel: "silent",
		metafile: true,
		outfile: durableOutputPath,
		write: false,
	});
	const durableInputs = durableBuild.metafile.inputs;
	for (const expectedInput of [
		"packages/durable/src/index.ts",
		"packages/durable/src/storage/memory.ts",
		"packages/durable/src/storage/sqlite/index.ts",
		"packages/durable/src/storage/sqlite/storage.ts",
	]) {
		if (!findInput(durableInputs, expectedInput)) {
			throw new Error(`Durable browser bundle does not include ${expectedInput}`);
		}
	}
	const nodeAdapter = findInput(durableInputs, "packages/durable/src/storage/sqlite/node.ts");
	if (nodeAdapter) throw new Error(`Durable browser bundle unexpectedly includes ${nodeAdapter}`);

	process.exit(0);
} catch (error) {
	let detailedErrors = "";
	if (error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)) {
		detailedErrors = error.errors
			.map((entry) => {
				const location = entry.location
					? `${entry.location.file}:${entry.location.line}:${entry.location.column}`
					: "";
				return [location, entry.text].filter(Boolean).join(" ");
			})
			.join("\n");
	}

	const baseError = error instanceof Error ? (error.stack ?? error.message) : String(error);
	writeFileSync(errorLogPath, [detailedErrors, baseError].filter(Boolean).join("\n\n"), "utf-8");
	console.error(`Browser smoke check failed. See ${errorLogPath}`);
	process.exit(1);
}
