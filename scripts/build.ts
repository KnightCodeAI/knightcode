// scripts/build.ts — run with `bun run scripts/build.ts [--single]`
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
// src/bun/cli.ts statically registers the bedrock provider and the Bun OAuth
// flows, which the plain node entry (src/cli.ts) loads dynamically. The image
// worker is a second entrypoint because it is spawned as its own module.
const ENTRY = join(ROOT, "packages/cli/src/bun/cli.ts");
const WORKER_ENTRY = join(ROOT, "packages/cli/src/utils/image-resize-worker.ts");

// In a compiled binary `getPackageDir()` is `dirname(process.execPath)` (see
// packages/cli/src/config.ts), so the runtime looks for package.json, themes,
// assets and templates *next to the executable*. Without this the binary
// reports version 0.0.0 and cannot load a theme.
const CLI = join(ROOT, "packages/cli");
function copyRuntimeAssets(outDir: string): void {
	cpSync(join(CLI, "package.json"), join(outDir, "package.json"));
	for (const f of ["README.md", "CHANGELOG.md"]) {
		const src = join(CLI, f);
		if (existsSync(src)) cpSync(src, join(outDir, f));
	}

	const theme = join(outDir, "theme");
	mkdirSync(theme, { recursive: true });
	const themeSrc = join(CLI, "src/modes/interactive/theme");
	for (const f of readdirSync(themeSrc)) {
		if (f.endsWith(".json")) cpSync(join(themeSrc, f), join(theme, f));
	}

	const assets = join(outDir, "assets");
	mkdirSync(assets, { recursive: true });
	const assetsSrc = join(CLI, "src/modes/interactive/assets");
	if (existsSync(assetsSrc)) {
		for (const f of readdirSync(assetsSrc)) cpSync(join(assetsSrc, f), join(assets, f));
	}

	const exportSrc = join(CLI, "src/core/export-html");
	const exportOut = join(outDir, "export-html");
	mkdirSync(join(exportOut, "vendor"), { recursive: true });
	for (const f of ["template.html", "template.css", "template.js"]) {
		const src = join(exportSrc, f);
		if (existsSync(src)) cpSync(src, join(exportOut, f));
	}
	const vendorSrc = join(exportSrc, "vendor");
	if (existsSync(vendorSrc)) cpSync(vendorSrc, join(exportOut, "vendor"), { recursive: true });

	const docs = join(CLI, "docs");
	if (existsSync(docs)) cpSync(docs, join(outDir, "docs"), { recursive: true });

	// photon-node reads photon_rs_bg.wasm relative to itself; see utils/photon.ts.
	for (const base of [join(CLI, "node_modules"), join(ROOT, "node_modules")]) {
		const wasm = join(base, "@silvia-odwyer/photon-node/photon_rs_bg.wasm");
		if (existsSync(wasm)) {
			cpSync(wasm, join(outDir, "photon_rs_bg.wasm"));
			break;
		}
	}
}

type Target = { os: string; arch: string; bunTarget: Bun.Build.CompileTarget };

const ALL_TARGETS: Target[] = [
	{ os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
	{ os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
	{ os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
	{ os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
	{ os: "win32", arch: "x64", bunTarget: "bun-windows-x64" },
];

const single = process.argv.includes("--single");
const targetFlag = process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);

let targets: Target[];
if (targetFlag) {
	// Explicit single target — used by the CI build matrix (one binary per runner,
	// plus linux-arm64 cross-compiled from the x64 runner).
	const found = ALL_TARGETS.find((t) => `${t.os}-${t.arch}` === targetFlag);
	if (!found) {
		const known = ALL_TARGETS.map((t) => `${t.os}-${t.arch}`).join(", ");
		console.error(`Unknown --target "${targetFlag}". Known: ${known}`);
		process.exit(1);
	}
	targets = [found];
} else if (single) {
	targets = ALL_TARGETS.filter((t) => t.os === process.platform && t.arch === process.arch);
} else {
	targets = ALL_TARGETS;
}

if (targets.length === 0) {
	console.error(`No build target for ${process.platform}-${process.arch}`);
	process.exit(1);
}

const version = (pkg as { version?: string }).version ?? "0.0.0-dev";

console.log(`Building version ${version}`);

for (const target of targets) {
	const outDir = join(ROOT, "packages", `cli-${target.os}-${target.arch}`, "bin");
	mkdirSync(outDir, { recursive: true });
	const binName = target.os === "win32" ? "knightcode.exe" : "knightcode";
	const outfile = join(outDir, binName);

	console.log(`Building ${target.os}-${target.arch} → ${outfile}`);
	const result = await Bun.build({
		entrypoints: [ENTRY, WORKER_ENTRY],
		target: "bun",
		compile: { target: target.bunTarget, outfile },
		define: {
			KNIGHTCODE_VERSION: JSON.stringify(version),
		},
	});

	if (!result.success) {
		console.error(`Build failed for ${target.os}-${target.arch}`);
		for (const log of result.logs) console.error(log);
		process.exit(1);
	}

	copyRuntimeAssets(outDir);

	// Compiled binaries must be executable on POSIX (npm preserves the mode bit).
	if (target.os !== "win32") chmodSync(outfile, 0o755);
}

console.log("Build complete.");
