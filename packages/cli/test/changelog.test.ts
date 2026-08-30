import { describe, expect, test } from "vitest";
import { type ChangelogEntry, normalizeChangelogLinks } from "../src/utils/changelog.ts";

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
