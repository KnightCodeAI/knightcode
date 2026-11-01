import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, safeHref } from "../src/chat/rich/Markdown.tsx";

// data-ref attributes are measurement hooks, not content.
const html = (text: string) =>
	renderToStaticMarkup(createElement(Markdown, { text })).replace(/ data-ref="[^"]*"/g, "");

describe("Markdown", () => {
	it("renders paragraphs and lists", () => {
		expect(html("A little about me:\n\n- one\n- two")).toBe(
			"<div><p>A little about me:</p><ul><li>one</li><li>two</li></ul></div>",
		);
	});
	it("never injects raw HTML or script", () => {
		const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
		expect(out).not.toContain("<script");
		expect(out).not.toContain("<img");
		expect(out).toContain("&lt;script&gt;");
	});
	it("keeps apostrophes and ampersands as typed", () => {
		expect(html("I'll do R&D")).toBe("<div><p>I&#x27;ll do R&amp;D</p></div>");
	});
	it("opens only web and mail links", () => {
		expect(safeHref("javascript:alert(1)")).toBe(false);
		expect(safeHref("https://example.com")).toBe(true);
		expect(html("[x](javascript:alert(1))")).not.toContain("href");
	});
});
