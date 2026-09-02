// scripts/ci-version.ts — run with `bun run ci:version`.
//
// Invoked by changesets/action in .github/workflows/publish.yml to produce the
// "chore(release): version packages" PR. Wraps `changeset version` with the
// lockstep guarantee pi enforces in scripts/sync-versions.js: the six
// @knightcodeai/cli* packages are a `fixed` group in .changeset/config.json, so
// they must always come out of a version bump at the identical version, and the
// main package's optionalDependencies must pin exactly that version. If either
// drifts, `npm install @knightcodeai/cli` resolves a platform package that was
// never published and the launcher has no binary to exec.
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { regroupTopSection } from "./changelog-sections.ts";

const ROOT = join(import.meta.dir, "..");

// Keep in sync with the `fixed` group in .changeset/config.json and the
// registry check in .github/workflows/publish.yml.
const MAIN = "@knightcodeai/cli";
const PLATFORM_TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

type Manifest = { name: string; version: string; optionalDependencies?: Record<string, string> };

function manifest(dir: string): Manifest {
	return JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
}

await $`bun x changeset version`.cwd(ROOT);

// Changesets groups the new section by semver bump; regroup it under Keep a
// Changelog headings, the way pi's changelogs read. Only the top section is
// touched, and never its `## <version>` line — publish.yml matches on that
// exactly to build the GitHub Release body.
for (const dir of ["cli", ...PLATFORM_TARGETS.map((target) => `cli-${target}`)]) {
	const path = join(ROOT, "packages", dir, "CHANGELOG.md");
	const { markdown, uncategorised } = regroupTopSection(readFileSync(path, "utf8"));
	writeFileSync(path, markdown);
	for (const entry of uncategorised) {
		console.warn(
			`${dir}/CHANGELOG.md: entry does not start with Added/Changed/Deprecated/Removed/` +
				`Fixed/Security, filed under Changed:\n  ${entry.split("\n")[0]}`,
		);
	}
}

// changesets rewrites package.json files; re-read from disk, never from an
// import cache that predates the bump.
const cli = manifest("cli");
const platforms = PLATFORM_TARGETS.map((target) => manifest(`cli-${target}`));

const versions = new Set([cli.version, ...platforms.map((p) => p.version)]);
if (versions.size !== 1) {
	const listed = [cli, ...platforms].map((p) => `  ${p.name}: ${p.version}`).join("\n");
	throw new Error(
		`Fixed-group packages are not lockstep after \`changeset version\`:\n${listed}\n` +
			`Check the \`fixed\` array in .changeset/config.json.`,
	);
}

const optional = cli.optionalDependencies ?? {};
const mismatched = platforms
	.filter((p) => optional[p.name] !== cli.version)
	.map((p) => `  ${p.name}: pinned ${optional[p.name] ?? "(absent)"}, expected ${cli.version}`);
if (mismatched.length > 0) {
	throw new Error(
		`${MAIN} optionalDependencies do not pin the release version:\n${mismatched.join("\n")}\n` +
			`Publishing this would ship a launcher whose platform package does not exist on npm.`,
	);
}

// Record the workspace version bumps in the lockfile so the Version PR is
// installable as-is.
await $`bun install --lockfile-only`.cwd(ROOT);

console.log(`Versioned ${MAIN} and ${platforms.length} platform packages at ${cli.version}`);
