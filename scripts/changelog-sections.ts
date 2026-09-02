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

// Keep a Changelog order. Anything uncategorised lands in Changed.
const CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] as const;
type Category = (typeof CATEGORIES)[number];
const FALLBACK: Category = "Changed";

// A generator prefix, then the verb. Covers @changesets/changelog-github
// ("- [#77](url) [`sha`](url) Thanks [@user](url)! - Fixed …"), the default
// generator ("- 736f894: Fixed …") and a bare "- Fixed …".
function categoryOf(entry: string): Category | null {
	const body = entry
		.replace(/^- /, "")
		.replace(/^(?:\[[^\]]*\]\([^)]*\) ?){1,3}/, "")
		.replace(/^Thanks \[[^\]]*\]\([^)]*\)! ?- ?/, "")
		.replace(/^[0-9a-f]{7,40}: /, "");
	const match = /^(Added|Changed|Deprecated|Removed|Fixed|Security)\b/.exec(body);
	return match ? (match[1] as Category) : null;
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
		const trimmed = entry.replace(/\s+$/, "");
		if (trimmed === "") continue;
		const category = categoryOf(trimmed);
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
	const { strictEqual, deepStrictEqual } = await import("node:assert/strict");

	// Two bump buckets collapse into one set of categories, ordered Added before
	// Fixed regardless of the order they appeared in, and 0.5.2 is untouched.
	const input = `# @knightcodeai/cli

## 0.5.3

### Minor Changes

- [#77](https://x/pull/77) [\`abc1234\`](https://x/commit/abc1234) Thanks [@raghavseth](https://x/raghavseth)! - Fixed a thing.

  With a second paragraph.

### Patch Changes

- 736f894: Added a flag.
- 9a492f9: Removed the old path.

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

- 736f894: Added a flag.

### Removed

- 9a492f9: Removed the old path.

### Fixed

- [#77](https://x/pull/77) [\`abc1234\`](https://x/commit/abc1234) Thanks [@raghavseth](https://x/raghavseth)! - Fixed a thing.

  With a second paragraph.

## 0.5.2

### Patch Changes

- deadbee: Untouched.
`,
	);

	// An entry with no leading verb is reported and falls into Changed.
	const fallback = regroupTopSection(`## 0.1.0

### Patch Changes

- abc1234: Tidy the transcript.
`);
	deepStrictEqual(fallback.uncategorised, ["- abc1234: Tidy the transcript."]);
	strictEqual(fallback.markdown.includes("### Changed"), true);

	// A platform package's bare version heading is left exactly as it was.
	const bare = "# @knightcodeai/cli-linux-x64\n\n## 0.5.3\n\n## 0.5.2\n";
	strictEqual(regroupTopSection(bare).markdown, bare);

	// A changelog with no released version yet.
	strictEqual(regroupTopSection("# @knightcodeai/cli\n").markdown, "# @knightcodeai/cli\n");

	console.log("changelog-sections self-check passed");
}
