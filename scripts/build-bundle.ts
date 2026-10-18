// scripts/build-bundle.ts — run with `bun run build:cli`.
//
// Builds the Node.js distribution that npm and the installer ship: an esbuild
// bundle of the CLI in packages/cli/dist/, run by the user's own Node (>=22.19).
// The Bun-compiled binaries (scripts/build.ts) are only release downloads.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { build, type BuildOptions, type Metafile, type Plugin } from "esbuild";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "packages/cli");
const CLI_SRC = join(CLI, "src");
const AI_SRC = join(ROOT, "packages/ai/src");
const DIST = join(CLI, "dist");
const BUNDLE = join(DIST, "bundle");

// Everything else is inlined. These stay on disk as dependencies of the published package.
const RUNTIME_DEPENDENCIES = new Set([
	// Reads photon_rs_bg.wasm next to its own entry.
	"@silvia-odwyer/photon-node",
	// Loaded only when an extension is imported; see lazyJitiPlugin.
	"jiti",
]);
// Optional packages whose callers fall back when they are absent.
const OPTIONAL_EXTERNALS = ["bufferutil", "utf-8-validate", "kerberos", "supports-color"];

// The source imports jiti/static so the Bun binary embeds its Babel transform. The Node
// package loads jiti from node_modules instead, and only when an extension is imported.
const lazyJitiPlugin: Plugin = {
	name: "lazy-jiti",
	setup(b) {
		b.onResolve({ filter: /^jiti\/static$/ }, () => ({ namespace: "lazy-jiti", path: "jiti/static" }));
		b.onLoad({ filter: /.*/, namespace: "lazy-jiti" }, () => ({
			contents: `
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let createJitiImpl;

export function createJiti(...args) {
	createJitiImpl ??= require("jiti").createJiti;
	return createJitiImpl(...args);
}
`,
			loader: "js",
		}));
	},
};

function commonOptions(): BuildOptions {
	return {
		absWorkingDir: ROOT,
		// Bundled CommonJS dependencies call require(); ESM output has none without this.
		banner: {
			js: 'import { createRequire as __kcCreateRequire } from "node:module"; const require = __kcCreateRequire(import.meta.url);',
		},
		bundle: true,
		define: { KNIGHTCODE_BUNDLED_NODE: "true" },
		external: ["@silvia-odwyer/photon-node", ...OPTIONAL_EXTERNALS],
		format: "esm",
		legalComments: "none",
		logLevel: "warning",
		metafile: true,
		minifySyntax: true,
		minifyWhitespace: true,
		platform: "node",
		plugins: [lazyJitiPlugin],
		sourcemap: false,
		target: "node22.19",
	};
}

// This script runs under Bun, whose isBuiltin() does not know node:sqlite.
const isNodeBuiltin = (specifier: string) => specifier.startsWith("node:") || isBuiltin(specifier);

function validateExternalImports(metafiles: Metafile[]): void {
	const allowed = new Set([...RUNTIME_DEPENDENCIES, ...OPTIONAL_EXTERNALS]);
	const unexpected = new Set<string>();
	for (const metafile of metafiles) {
		for (const input of Object.values(metafile.inputs)) {
			for (const imported of input.imports) {
				if (!imported.external || isNodeBuiltin(imported.path) || allowed.has(imported.path)) continue;
				unexpected.add(imported.path);
			}
		}
	}
	if (unexpected.size > 0) {
		throw new Error(`Bundle left unexpected external imports: ${[...unexpected].sort().join(", ")}`);
	}
}

function findContainingOutput(metafile: Metafile, inputSuffix: string): string {
	for (const [outputPath, output] of Object.entries(metafile.outputs)) {
		if (Object.keys(output.inputs).some((input) => input.replaceAll("\\", "/").endsWith(inputSuffix))) {
			return resolve(ROOT, outputPath);
		}
	}
	throw new Error(`Could not locate bundled output containing ${inputSuffix}`);
}

rmSync(DIST, { force: true, recursive: true });
mkdirSync(BUNDLE, { recursive: true });

const main = await build({
	...commonOptions(),
	entryNames: "[name]",
	entryPoints: { "cli-runtime": join(CLI_SRC, "cli.ts") },
	outdir: BUNDLE,
	chunkNames: "chunks/[name]-[hash]",
	splitting: true,
});

// These implementations are reached through variable-specifier imports or a worker URL,
// so the main bundle cannot follow them. Each is emitted beside the code that resolves it.
const oauthLoader = findContainingOutput(main.metafile, "packages/ai/src/auth/oauth/load.ts");
const bedrockLoader = findContainingOutput(main.metafile, "packages/ai/src/api/bedrock-converse-stream.lazy.ts");
const imageResize = findContainingOutput(main.metafile, "packages/cli/src/utils/image-resize.ts");
const config = findContainingOutput(main.metafile, "packages/cli/src/config.ts");
const lazyDir = dirname(oauthLoader);
for (const [label, output] of [
	["bedrock loader", bedrockLoader],
	["image resize", imageResize],
	// getCodemodeWorkerSpecifier() resolves ./codemode-worker.js next to config.ts.
	["config", config],
] as const) {
	if (dirname(output) !== lazyDir) throw new Error(`The ${label} chunk was emitted outside ${lazyDir}`);
}

const lazyEntryPoints: Record<string, string> = {
	"bedrock-converse-stream": join(AI_SRC, "api/bedrock-converse-stream.ts"),
	"image-resize-worker": join(CLI_SRC, "utils/image-resize-worker.ts"),
};
// Every flow importOAuthModule() loads needs its own file, or it fails at runtime with a missing module.
const oauthLoadSource = readFileSync(join(AI_SRC, "auth/oauth/load.ts"), "utf8");
for (const match of oauthLoadSource.matchAll(/importOAuthModule\("\.\/([^"]+)\.ts"\)/g)) {
	lazyEntryPoints[match[1]!] = join(AI_SRC, "auth/oauth", `${match[1]}.ts`);
}

const lazy = await build({
	...commonOptions(),
	entryNames: "[name]",
	entryPoints: lazyEntryPoints,
	outdir: lazyDir,
	splitting: false,
});

// getCodemodeWorkerSpecifier() spawns the worker from an in-memory data: URL so codemode survives
// an update that replaces the install. A data: URL module has no file location, so the worker
// must not use the createRequire banner, require(), or imports other than Node builtins.
const codemodeWorker = await build({
	...commonOptions(),
	banner: undefined,
	entryNames: "[name]",
	entryPoints: { "codemode-worker": join(CLI_SRC, "extensions/codemode/worker.ts") },
	outdir: lazyDir,
	splitting: false,
});
for (const [outputPath, output] of Object.entries(codemodeWorker.metafile.outputs)) {
	const invalid = output.imports.filter(
		(imported) => imported.kind !== "import-statement" || !isNodeBuiltin(imported.path),
	);
	if (invalid.length > 0) {
		throw new Error(`Codemode worker must only import Node builtins: ${invalid.map((i) => i.path).join(", ")}`);
	}
	if (readFileSync(resolve(ROOT, outputPath), "utf8").includes("import.meta")) {
		throw new Error("Codemode worker must not use import.meta");
	}
}

const metafiles = [main.metafile, lazy.metafile, codemodeWorker.metafile];
validateExternalImports(metafiles);

// The launcher stays tiny so Node's compile cache covers the large runtime file.
const launcher = `#!/usr/bin/env node
import { createRequire, enableCompileCache } from "node:module";

enableCompileCache?.();
createRequire(import.meta.url)("./cli-runtime.js");
`;
writeFileSync(join(BUNDLE, "cli.js"), launcher);
chmodSync(join(BUNDLE, "cli.js"), 0o755);

// Assets config.ts resolves under dist/ when the package has no src/. Same set scripts/build.ts
// puts next to the binary.
for (const dir of ["modes/interactive/theme", "modes/interactive/assets"]) {
	if (existsSync(join(CLI_SRC, dir))) cpSync(join(CLI_SRC, dir), join(DIST, dir), { recursive: true });
}
const exportSrc = join(CLI_SRC, "core/export-html");
const exportOut = join(DIST, "core/export-html");
mkdirSync(exportOut, { recursive: true });
for (const file of ["template.html", "template.css", "template.js"]) {
	if (existsSync(join(exportSrc, file))) cpSync(join(exportSrc, file), join(exportOut, file));
}
if (existsSync(join(exportSrc, "vendor")))
	cpSync(join(exportSrc, "vendor"), join(exportOut, "vendor"), { recursive: true });

// native-module-path.ts looks for native/ beside the module and one level up, which covers
// both dist/bundle/ and dist/bundle/chunks/. Ship every platform: one package serves all.
const nativeRoot = join(ROOT, "packages/tui/native");
for (const os of readdirSync(nativeRoot)) {
	const prebuilds = join(nativeRoot, os, "prebuilds");
	if (existsSync(prebuilds)) cpSync(prebuilds, join(BUNDLE, "native", os, "prebuilds"), { recursive: true });
}

const bytes = metafiles.reduce(
	(total, metafile) => total + Object.values(metafile.outputs).reduce((sum, output) => sum + output.bytes, 0),
	launcher.length,
);
const files = new Set(metafiles.flatMap((metafile) => Object.keys(metafile.outputs))).size + 1;
console.log(`Built ${relative(ROOT, BUNDLE)} (${files} files, ${(bytes / (1024 * 1024)).toFixed(1)} MiB)`);
