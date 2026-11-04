import { describe, expect, test } from "vitest";
import {
	type ChangelogEntry,
	getChangelogHighlights,
	getNewEntries,
	normalizeChangelogLinks,
} from "../src/utils/changelog.ts";

const entry: ChangelogEntry = {
	major: 0,
	minor: 79,
	patch: 0,
	content: "",
};

describe("normalizeChangelogLinks", () => {
	test("rewrites package-relative changelog links to tag-pinned GitHub source links", () => {
		const markdown = [
			"[Project Trust](README.md#project-trust)",
			"[Extensions](docs/extensions.md#project_trust)",
			"[Examples](examples/extensions/)",
			"[Root README](../../README.md#supply-chain-hardening)",
		].join("\n");

		expect(normalizeChangelogLinks(markdown, entry)).toBe(
			[
				"[Project Trust](https://github.com/KnightCodeAI/knightcode/blob/v0.79.0/packages/cli/README.md#project-trust)",
				"[Extensions](https://github.com/KnightCodeAI/knightcode/blob/v0.79.0/packages/cli/docs/extensions.md#project_trust)",
				"[Examples](https://github.com/KnightCodeAI/knightcode/tree/v0.79.0/packages/cli/examples/extensions/)",
				"[Root README](https://github.com/KnightCodeAI/knightcode/blob/v0.79.0/README.md#supply-chain-hardening)",
			].join("\n"),
		);
	});

	test("pins floating refs without changing external links", () => {
		const markdown = [
			"[#4163](https://github.com/KnightCodeAI/knightcode/issues/4163)",
			"[Agent README](https://github.com/KnightCodeAI/knightcode/blob/main/packages/agent/README.md)",
			"[External](https://example.com/docs)",
			"[Local anchor](#settings)",
		].join("\n");

		expect(normalizeChangelogLinks(markdown, "0.79.0")).toBe(
			[
				"[#4163](https://github.com/KnightCodeAI/knightcode/issues/4163)",
				"[Agent README](https://github.com/KnightCodeAI/knightcode/blob/v0.79.0/packages/agent/README.md)",
				"[External](https://example.com/docs)",
				"[Local anchor](#settings)",
			].join("\n"),
		);
	});
});

describe("getChangelogHighlights", () => {
	test("returns top-level bullets as plain text, newest entry first", () => {
		const newer = {
			...entry,
			minor: 80,
			content: [
				"## 0.80.0",
				"### Added",
				"- Added `--flag` to **see** [docs](docs/a.md).",
				"  continued line",
				"### Fixed",
				"- Fixed a crash.",
			].join("\n"),
		};
		const older = { ...entry, content: "## 0.79.0\n\n- Changed the footer." };
		expect(getChangelogHighlights([newer, older])).toEqual([
			"Added --flag to see docs.",
			"Fixed a crash.",
			"Changed the footer.",
		]);
	});

	test("keeps underscores inside code spans and drops empty bullets", () => {
		const content = "- Fixed __bold__ `mcp__my-server__x` calls.\n- \n- `` ";
		expect(getChangelogHighlights([{ ...entry, content }])).toEqual(["Fixed bold mcp__my-server__x calls."]);
	});
});

describe("getNewEntries", () => {
	const entries: ChangelogEntry[] = [
		{ major: 0, minor: 1, patch: 5, content: "0.1.5" },
		{ major: 0, minor: 1, patch: 4, content: "0.1.4" },
	];
	const newContent = (lastVersion: string) => getNewEntries(entries, lastVersion)?.map((e) => e.content);

	test("ignores prerelease and build suffixes of the last seen version", () => {
		expect(newContent("0.1.5-20261020.7")).toEqual([]);
		expect(newContent("0.1.5+build.3")).toEqual([]);
		expect(newContent("0.1.4-beta.1")).toEqual(["0.1.5"]);
	});

	test("compares release versions numerically", () => {
		expect(newContent("0.1.5")).toEqual([]);
		expect(newContent("0.1.3")).toEqual(["0.1.5", "0.1.4"]);
		expect(getNewEntries([{ major: 0, minor: 10, patch: 0, content: "0.10.0" }], "0.9.0")?.length).toBe(1);
	});

	test("returns undefined for a last seen version without major.minor.patch", () => {
		expect(newContent("latest")).toBeUndefined();
		expect(newContent("0.1")).toBeUndefined();
		expect(newContent("")).toBeUndefined();
	});
});
