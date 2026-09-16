import { setKeybindings } from "@knightcode/tui";
import type { Theme } from "@knightcodeai/cli";
import { KeybindingsManager } from "@knightcodeai/cli/core/keybindings";
import { beforeAll, describe, expect, test } from "vitest";
import { webfetchCallText, webfetchResultText, websearchCallText, websearchResultText } from "../src/web/render.ts";

// A theme that tags colours so assertions can see which role each span got.
const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `*${text}*`,
} as unknown as Theme;

// The expand hint reads the app keybindings, which only the interactive mode installs.
beforeAll(() => setKeybindings(new KeybindingsManager()));

const fetchDetails = {
	url: "https://example.com/docs/a-very-long-path-that-keeps-going-and-going-and-going-past-eighty-characters",
	finalUrl: "https://example.com/x",
	contentType: "text/html",
	bytes: 18_432,
	totalLines: 1832,
	from: 1,
	to: 400,
	truncated: true,
	cached: false,
};

describe("webfetch", () => {
	test("call shows the tool name, a shortened url and the grep or offset", () => {
		expect(webfetchCallText({ url: "https://bun.sh/docs" }, theme)).toBe(
			"<toolTitle>*webfetch*</toolTitle>(<accent>https://bun.sh/docs</accent>)",
		);
		expect(webfetchCallText({ url: fetchDetails.url }, theme)).toContain("…</accent>)");
		expect(webfetchCallText({ url: "u", grep: "install" }, theme)).toContain(
			"<accent>u</accent><toolOutput>, grep install</toolOutput>",
		);
		expect(webfetchCallText({ url: "u", offset: 401 }, theme)).toContain(", offset 401");
		expect(webfetchCallText(undefined, theme)).toBe("<toolTitle>*webfetch*</toolTitle>(<accent></accent>)");
	});

	test("collapsed result summarises size, lines and cache state", () => {
		const result = { content: [{ type: "text", text: "body" }], details: fetchDetails };
		expect(webfetchResultText(result, false, theme)).toMatch(
			/^<toolOutput>18\.0KB, lines 1-400 of 1832<\/toolOutput> <muted>\(.+ to expand\)<\/muted>$/,
		);
		expect(webfetchResultText({ ...result, details: { ...fetchDetails, cached: true } }, false, theme)).toContain(
			"(cached)",
		);
		expect(webfetchResultText({ ...result, details: { ...fetchDetails, matches: 7 } }, false, theme)).toContain(
			"7 matches of 1832 lines",
		);
	});

	test("expanded result prints the content; an error result prints its first line", () => {
		const result = { content: [{ type: "text", text: "line one\nline two" }], details: fetchDetails };
		expect(webfetchResultText(result, true, theme)).toBe(
			"<toolOutput>line one</toolOutput>\n<toolOutput>line two</toolOutput>",
		);
		expect(webfetchResultText({ content: [{ type: "text", text: "Blocked: nope\nmore" }] }, false, theme)).toBe(
			"<toolOutput>Blocked: nope</toolOutput>",
		);
	});
});

describe("websearch", () => {
	const details = {
		query: "bun docs",
		provider: "duckduckgo" as const,
		results: [{ title: "t", url: "u", snippet: "s" }],
	};

	test("call quotes the query", () => {
		expect(websearchCallText({ query: "bun docs" }, theme)).toBe(
			'<toolTitle>*websearch*</toolTitle>(<accent>"bun docs"</accent>)',
		);
	});

	test("collapsed result counts results and names the provider", () => {
		const result = { content: [{ type: "text", text: "1 results…" }], details };
		expect(websearchResultText(result, false, theme)).toMatch(
			/^<toolOutput>1 results \(duckduckgo\)<\/toolOutput> <muted>\(.+ to expand\)<\/muted>$/,
		);
		expect(websearchResultText(result, true, theme)).toBe("<toolOutput>1 results…</toolOutput>");
	});
});
