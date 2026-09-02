// scripts/changelog-sections.ts — self-check with `bun run scripts/changelog-sections.ts`.
//
// Changesets groups a version's entries by semver bump ("### Patch Changes"),
// and that is not configurable: apply-release-plan hardcodes `## <version>`
// plus exactly three major/minor/patch buckets, and a custom `changelog` module
// only supplies the text of one bullet. So pi's Keep a Changelog headings
// (### Added / ### Fixed / …) have to be applied after `changeset version`
// runs — see scripts/ci-version.ts, which calls this on each CHANGELOG.md.
//
// The category comes from the first word of the changeset summary, the same
// convention pi writes by hand ("Fixed toggling thinking visibility…"). It
// cannot live in the frontmatter: @changesets/parse reads every frontmatter key
// as a package name whose value must be major|minor|patch|none.
//
// The generator prefixes each entry with the commit that added the changeset
// file ("- 6ffe494: Fixed …"). That is dropped here: it identifies the changeset,
// not the change, and an entry reads better as a plain sentence.
import { Glob } from "bun";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { join } from "node:path";

// Keep a Changelog order. Anything uncategorised lands in Changed.
export const CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] as const;
type Category = (typeof CATEGORIES)[number];
const FALLBACK: Category = "Changed";

// "- 6ffe494: Fixed …" and "- Fixed …" both become "- Fixed …".
function stripCommitPrefix(entry: string): string {
	return entry.replace(/^- [0-9a-f]{7,40}: /, "- ");
}

// The category is the first word of the changeset summary — the sentence a
// contributor writes, never the "- " bullet the generator wraps it in. Both
// callers hand this the same bare form, so the CI check and the release
// grouping cannot disagree; accepting either form is what let a summary that
// is itself a bullet pass CI and then render as "- - Added …". A verb with
// nothing after it is not a category either; that is an unfinished changeset.
function categoryOf(summary: string): Category | null {
	const match = /^(Added|Changed|Deprecated|Removed|Fixed|Security)\b(.*)/.exec(summary);
	return match && match[2]!.trim() !== "" ? (match[1] as Category) : null;
}

/**
 * Rewrites the top-most `## <version>` section of a CHANGELOG, replacing the
 * `### Patch Changes` style headings with Keep a Changelog categories. Every
 * other section is left byte-for-byte alone, and so is the `## <version>` line
 * itself — publish.yml extracts release notes with an exact match on it.
 *
 * Returns the rewritten markdown plus the entries whose category could not be
 * read, so the caller can warn about them.
 */
export function regroupTopSection(markdown: string): { markdown: string; uncategorised: string[] } {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.startsWith("## "));
	if (start === -1) return { markdown, uncategorised: [] };

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i]!.startsWith("## ")) {
			end = i;
			break;
		}
	}

	// Platform packages get a bare `## 0.5.3` with no entries under it.
	const body = lines.slice(start + 1, end);
	if (!body.some((line) => line.startsWith("### "))) return { markdown, uncategorised: [] };

	// An entry runs from its "- " line to the next "- ", heading, or end.
	const entries: string[] = [];
	for (const line of body) {
		if (line.startsWith("### ")) continue;
		if (line.startsWith("- ")) entries.push(line);
		else if (entries.length > 0) entries[entries.length - 1] += `\n${line}`;
	}

	const grouped = new Map<Category, string[]>();
	const uncategorised: string[] = [];
	for (const entry of entries) {
		const trimmed = stripCommitPrefix(entry.replace(/\s+$/, ""));
		if (trimmed === "") continue;
		// The bullet belongs to the rendered entry, not to the summary.
		const category = categoryOf(trimmed.replace(/^- /, ""));
		if (category === null) uncategorised.push(trimmed);
		const bucket = category ?? FALLBACK;
		grouped.set(bucket, [...(grouped.get(bucket) ?? []), trimmed]);
	}

	const rebuilt: string[] = [];
	for (const category of CATEGORIES) {
		const bucket = grouped.get(category);
		if (!bucket) continue;
		rebuilt.push(`### ${category}`, "", ...bucket.flatMap((entry) => [entry, ""]));
	}

	return {
		markdown: [...lines.slice(0, start + 1), "", ...rebuilt, ...lines.slice(end)].join("\n"),
		uncategorised,
	};
}

if (import.meta.main) {
	// Two bump buckets collapse into one set of categories, ordered Added before
	// Fixed however they appeared, commit prefixes are dropped, a multi-paragraph
	// entry keeps its continuation lines, and 0.5.2 is untouched.
	const input = `# @knightcodeai/cli

## 0.5.3

### Minor Changes

- 736f894: Added a flag.

### Patch Changes

- 9a492f9: Removed the old path.
- c058c12: Fixed a thing.

  With a second paragraph.

## 0.5.2

### Patch Changes

- deadbee: Untouched.
`;
	const { markdown, uncategorised } = regroupTopSection(input);
	deepStrictEqual(uncategorised, []);
	strictEqual(
		markdown,
		`# @knightcodeai/cli

## 0.5.3

### Added

- Added a flag.

### Removed

- Removed the old path.

### Fixed

- Fixed a thing.

  With a second paragraph.

## 0.5.2

### Patch Changes

- deadbee: Untouched.
`,
	);

	// An entry with no leading verb is reported and falls into Changed, with its
	// commit prefix dropped like any other.
	const fallback = regroupTopSection(`## 0.1.0

### Patch Changes

- abc1234: Tidy the transcript.
`);
	deepStrictEqual(fallback.uncategorised, ["- Tidy the transcript."]);
	strictEqual(fallback.markdown.includes("### Changed"), true);
	strictEqual(fallback.markdown.includes("abc1234"), false);

	// The predicate reads a bare summary, and the CI check hands it the same
	// form, so the two never disagree: punctuation or a tab after the category is
	// fine; a lone verb is an unfinished changeset; a word that merely starts
	// with one is not a category; and neither is an already-bulleted summary.
	strictEqual(categoryOf("Added: a flag."), "Added");
	strictEqual(categoryOf("Added\ta flag."), "Added");
	strictEqual(categoryOf("Fixed"), null);
	strictEqual(categoryOf("Addedstuff a flag."), null);
	strictEqual(categoryOf("- Added a flag."), null);

	// A summary written as a bullet renders as "- - Added …". It is reported
	// rather than categorised, and CI rejects the same summary up front.
	const nested = regroupTopSection(`## 0.1.0

### Patch Changes

- abc1234: - Added a flag.
`);
	deepStrictEqual(nested.uncategorised, ["- - Added a flag."]);

	// A platform package's bare version heading is left exactly as it was.
	const bare = "# @knightcodeai/cli-linux-x64\n\n## 0.5.3\n\n## 0.5.2\n";
	strictEqual(regroupTopSection(bare).markdown, bare);

	// A changelog with no released version yet.
	strictEqual(regroupTopSection("# @knightcodeai/cli\n").markdown, "# @knightcodeai/cli\n");

	console.log("changelog-sections self-check passed");

	// The category is only ever the first word of a summary, so check it here,
	// where a contributor can still fix it. The release job's warning arrives
	// after the entry has already been filed under the wrong heading.
	const dir = join(import.meta.dir, "..", ".changeset");
	const bad: string[] = [];
	for await (const file of new Glob("*.md").scan(dir)) {
		if (file === "README.md") continue;
		// Frontmatter, then the summary: "---", packages, "---", the sentence.
		const summary = (await Bun.file(join(dir, file)).text()).split(/^---\s*$/m)[2]?.trim() ?? "";
		if (categoryOf(summary) === null) bad.push(`.changeset/${file}`);
	}
	if (bad.length > 0) {
		console.error(
			`Changeset summary must start with ${CATEGORIES.join("/")}, then the sentence — ` +
				`see CONTRIBUTING.md:\n  ` +
				bad.join("\n  "),
		);
		process.exit(1);
	}
}
