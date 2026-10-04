// Builds the package.json and package-lock.json that install.sh and
// `knightcode update` download. Run after @knightcodeai/cli is on npm.
//
//   bun run scripts/generate-installer-lock.ts --out release-assets
//   bun run scripts/generate-installer-lock.ts --bundle
//
// The lock is resolved outside this repo so the root .npmrc min-release-age
// does not hide a version that was just published.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installerPackageJson,
	missingPlatformPackages,
	validateInstallerLock,
} from "../apps/web/lib/installer-lock.ts";

const repoRoot = join(import.meta.dir, "..");

function readArg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} needs a value`);
	}
	return value;
}

function packageVersion(): string {
	const explicit = readArg("--version");
	if (explicit) return explicit;
	const manifest = JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")) as {
		version?: string;
	};
	if (!manifest.version) throw new Error("packages/cli/package.json has no version");
	return manifest.version;
}

const version = packageVersion();
const manifest = installerPackageJson(version);

function resolveLock(): { version?: string } {
	const stage = mkdtempSync(join(tmpdir(), "knightcode-installer-lock-"));
	try {
		writeFileSync(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		const npm = spawnSync(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--package-lock-only",
				"--omit=dev",
				"--include=optional",
				"--no-fund",
				"--no-audit",
				"--min-release-age=0",
			],
			{
				cwd: stage,
				shell: process.platform === "win32",
				stdio: "inherit",
				env: { ...process.env, npm_config_min_release_age: "0" },
			},
		);
		if (npm.status !== 0) {
			throw new Error(`npm install --package-lock-only exited with ${npm.status ?? "unknown"}`);
		}
		return JSON.parse(readFileSync(join(stage, "package-lock.json"), "utf8")) as { version?: string };
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

const lock = resolveLock();
if (lock.version !== version) lock.version = version;
const lockError = validateInstallerLock(lock, version);
if (lockError) throw new Error(lockError);
const missing = missingPlatformPackages(lock);
if (missing.length > 0) {
	throw new Error(`installer lock is missing platform packages: ${missing.join(", ")}`);
}

const body = `${JSON.stringify(lock, null, 2)}\n`;
const out = readArg("--out");
if (out) {
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "installer-package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	writeFileSync(join(out, "installer-package-lock.json"), body);
	console.log(`Wrote installer lock for ${version} to ${out}`);
}

if (process.argv.includes("--bundle")) {
	const bundleDir = join(repoRoot, "apps/web/lib/installer-locks");
	mkdirSync(bundleDir, { recursive: true });
	writeFileSync(join(bundleDir, `${version}.json`), body);
	console.log(`Wrote bundled installer lock apps/web/lib/installer-locks/${version}.json`);
}

if (!out && !process.argv.includes("--bundle")) {
	throw new Error("Pass --out <dir>, --bundle, or both");
}
