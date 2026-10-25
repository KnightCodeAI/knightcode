// scripts/ci-version.ts — run with `bun run ci:version`.
//
// Invoked by changesets/action in .github/workflows/publish.yml to produce the
// "chore(release): version packages" PR: `changeset version`, then the
// changelog regrouping and lockfile refresh the PR needs to be mergeable as-is.
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { regroupTopSection } from "./changelog-sections.ts";

const ROOT = join(import.meta.dir, "..");
// The packages whose changelogs are read: the CLI on npm, and the desktop app,
// which changesets versions but never publishes (.github/workflows/desktop-release.yml
// releases it).
const PACKAGES = [
	{ name: "@knightcodeai/cli", dir: "packages/cli" },
	{ name: "@knightcode/desktop", dir: "apps/desktop" },
];

// changesets rewrites package.json; read from disk, never from an import cache
// that predates the bump.
const versionOf = (dir: string) =>
	(JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { version: string }).version;

const before = PACKAGES.map(({ dir }) => versionOf(dir));

await $`bun x changeset version`.cwd(ROOT);

// Changesets groups the new section by semver bump; regroup it under Keep a
// Changelog headings, the way pi's changelogs read. Only the top section of a
// package this run versioned is touched, and never its `## <version>` line —
// the release workflows match on that exactly to build the GitHub Release body.
for (const [i, { name, dir }] of PACKAGES.entries()) {
	const version = versionOf(dir);
	if (version === before[i]) continue;
	const changelog = join(ROOT, dir, "CHANGELOG.md");
	const { markdown, uncategorised } = regroupTopSection(readFileSync(changelog, "utf8"));
	writeFileSync(changelog, markdown);
	for (const entry of uncategorised) {
		console.warn(
			`${dir}/CHANGELOG.md: entry does not start with Added/Changed/Deprecated/Removed/` +
				`Fixed/Security, filed under Changed:\n  ${entry.split("\n")[0]}`,
		);
	}
	console.log(`Versioned ${name} at ${version}`);
}

// Record the workspace version bumps in the lockfile so the Version PR is
// installable as-is.
await $`bun install --lockfile-only`.cwd(ROOT);
