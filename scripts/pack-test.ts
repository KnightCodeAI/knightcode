// scripts/pack-test.ts — validate the published install end-to-end, locally.
// Packs @knightcodeai/cli with real `npm pack`, installs the tarball into a
// throwaway project the way users get it, and runs the installed command.
import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";

const ROOT = join(import.meta.dir, "..");
const expectedVersion = pkg.version;
const mainDir = join(ROOT, "packages", "cli");

if (!existsSync(join(mainDir, pkg.bin.knightcode))) {
	console.log("Bundle missing — building it...");
	await $`bun run ${join(ROOT, "scripts", "build-bundle.ts")}`.cwd(ROOT);
}

const work = mkdtempSync(join(tmpdir(), "kc-packtest-"));
const proj = join(work, "proj");
mkdirSync(proj);

try {
	// npm prints the tarball filename.
	const tarball = (await $`npm pack --silent --pack-destination ${work}`.cwd(mainDir).text()).trim();

	await $`npm init -y`.cwd(proj).quiet();
	// --ignore-scripts and --omit=dev match the installer and the documented commands.
	await $`npm install --no-audit --no-fund --ignore-scripts --omit=dev ${join(work, tarball)}`.cwd(proj);

	// Run the bin through npm's own shim, so a wrong `bin` path or a missing
	// runtime dependency fails here.
	const run = (...args: string[]) => $`npm exec --offline --no -- knightcode ${args}`.cwd(proj).nothrow().quiet();

	// --version must print exactly the package version. Check the exit code first:
	// a bin that crashes on startup prints nothing, and "got ''" hides why.
	const versionRun = await run("--version");
	if (versionRun.exitCode !== 0) {
		throw new Error(`--version exited ${versionRun.exitCode}: ${versionRun.stderr.toString()}`);
	}
	const version = versionRun.stdout.toString().trim();
	if (version !== expectedVersion) {
		throw new Error(`--version mismatch: got "${version}", expected "${expectedVersion}"`);
	}
	console.log(`✓ --version → ${version}`);

	// --help must exit 0 and print the usage banner. It is the only command that
	// exercises the bin → bundle → arg-parsing path without needing an API key:
	// anything unrecognised is treated as a prompt and sent to the provider, so an
	// invented subcommand "passes" by talking to a model instead of failing.
	const help = await run("--help");
	if (help.exitCode !== 0) {
		throw new Error(`--help exited ${help.exitCode}: ${help.stderr.toString()}`);
	}
	if (!help.stdout.toString().includes("Usage:")) {
		throw new Error("--help printed no usage banner");
	}
	console.log("✓ --help exit 0");

	// The TUI's native helpers ship inside the bundle for every platform. Check the
	// <platform>-<arch> directory loadNativePlatformHelper reads, not just the OS.
	const target = `${process.platform}-${process.arch}`;
	const prebuilds = join(process.platform, "prebuilds", target);
	const shipped = join(proj, "node_modules", "@knightcodeai", "cli", "dist", "bundle", "native", prebuilds);
	if (existsSync(join(ROOT, "packages", "tui", "native", prebuilds)) && !existsSync(shipped)) {
		throw new Error(`Package has no native helpers for ${target}`);
	}
	console.log("✓ native helpers present");

	console.log(`pack-test passed on ${process.platform}-${process.arch}`);
} finally {
	try {
		rmSync(work, { recursive: true, force: true });
	} catch {
		// Windows may hold a handle on the temp sqlite db — OS reaps it.
	}
}
