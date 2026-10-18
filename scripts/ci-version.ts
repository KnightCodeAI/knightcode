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
const MAIN = "@knightcodeai/cli";

await $`bun x changeset version`.cwd(ROOT);

// Changesets groups the new section by semver bump; regroup it under Keep a
// Changelog headings, the way pi's changelogs read. Only the top section is
// touched, and never its `## <version>` line — publish.yml matches on that
// exactly to build the GitHub Release body.
const changelog = join(ROOT, "packages", "cli", "CHANGELOG.md");
const { markdown, uncategorised } = regroupTopSection(readFileSync(changelog, "utf8"));
writeFileSync(changelog, markdown);
for (const entry of uncategorised) {
	console.warn(
		`cli/CHANGELOG.md: entry does not start with Added/Changed/Deprecated/Removed/` +
			`Fixed/Security, filed under Changed:\n  ${entry.split("\n")[0]}`,
	);
}

// Record the workspace version bump in the lockfile so the Version PR is
// installable as-is.
await $`bun install --lockfile-only`.cwd(ROOT);

// changesets rewrites package.json; re-read from disk, never from an import cache
// that predates the bump.
const { version } = JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8")) as {
	version: string;
};
console.log(`Versioned ${MAIN} at ${version}`);
