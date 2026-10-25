// scripts/desktop-release-notes.ts — run with `bun run scripts/desktop-release-notes.ts <version> [since]`.
//
// Prints the desktop release's notes from apps/desktop/CHANGELOG.md: everything
// changesets wrote for `version` and the versions after `since`, the last
// published desktop release (see releaseNotes). .github/workflows/desktop-release.yml
// puts them in the draft release, whose body the update feed shows as what's new.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { releaseNotes } from "./changelog-sections.ts";

const [version, since] = Bun.argv.slice(2);
if (!version) throw new Error("usage: desktop-release-notes.ts <version> [since]");

const path = join(import.meta.dir, "..", "apps", "desktop", "CHANGELOG.md");
const notes = existsSync(path) ? releaseNotes(readFileSync(path, "utf8"), version, since || undefined) : undefined;
if (notes === undefined) {
	console.error(
		`::error::apps/desktop/CHANGELOG.md has no "## ${version}" section. The desktop version comes from ` +
			"changesets: add a @knightcode/desktop changeset and merge the Version Packages PR that bumps it.",
	);
	process.exit(1);
}
console.log(notes);
