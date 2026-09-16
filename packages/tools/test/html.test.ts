import { describe, expect, test } from "vitest";
import {
	decodeEntities,
	extractTitle,
	htmlToMarkdown,
	isHtmlContentType,
	isTextContentType,
	pickMainContent,
	stripTags,
} from "../src/web/html.ts";

const page = `<!doctype html><html><head><title>Bun &amp; Docs</title><style>.x{}</style></head>
<body>
<nav><a href="/a">Sidebar link</a></nav>
<main>
<h1>Install</h1>
<p>Run <code>bun install</code> to <a href="https://bun.sh/x">install</a>.</p>
<pre><code class="language-sh">bun add turndown</code></pre>
<article><h2>Nested</h2><p>inside main</p></article>
<script>alert(1)</script>
</main>
<footer>© 2026</footer>
</body></html>`;

describe("pickMainContent", () => {
	test("prefers <main>, keeping a nested <article>", () => {
		const picked = pickMainContent(page);
		expect(picked).toContain("<h1>Install</h1>");
		expect(picked).toContain("inside main");
		expect(picked).not.toContain("Sidebar link");
	});

	test("falls back to <article>, then <body>, then the whole string", () => {
		expect(pickMainContent("<body><article><p>a</p></article><p>b</p></body>")).toBe("<p>a</p>");
		expect(pickMainContent("<body><p>b</p></body>")).toBe("<p>b</p>");
		expect(pickMainContent("<p>frag</p>")).toBe("<p>frag</p>");
	});

	test("takes the longest of several candidates", () => {
		expect(pickMainContent("<article>short</article><main>much longer content</main>")).toBe("much longer content");
	});

	test("a nested <article> closes the inner one, so the outer keeps its tail", () => {
		const nested = "<article><h1>Outer</h1><article><p>inner</p></article><p>after the inner one</p></article>";
		expect(pickMainContent(nested)).toBe("<h1>Outer</h1><article><p>inner</p></article><p>after the inner one</p>");
	});

	test("a stray closing tag is ignored", () => {
		expect(pickMainContent("<body></article><main>x</main></body>")).toBe("x");
	});
});

describe("htmlToMarkdown", () => {
	test("converts headings, inline code, links and fenced code; drops junk tags", () => {
		const md = htmlToMarkdown(pickMainContent(page));
		expect(md).toContain("# Install");
		expect(md).toContain("`bun install`");
		expect(md).toContain("[install](https://bun.sh/x)");
		expect(md).toContain("```sh\nbun add turndown\n```");
		expect(md).not.toContain("alert(1)");
	});

	test("drops nav, header, footer, aside, svg, iframe and form from a whole page", () => {
		const md = htmlToMarkdown(
			"<body><header>H</header><nav>N</nav><aside>A</aside><svg><text>S</text></svg><iframe>I</iframe><form>F</form><p>keep</p><footer>Fo</footer></body>",
		);
		expect(md).toBe("keep");
	});

	test("collapses runs of blank lines and trims", () => {
		const md = htmlToMarkdown("<p>a</p><br><br><br><p>b</p>  ");
		expect(md).not.toMatch(/\n{3,}/);
		expect(md.startsWith("a")).toBe(true);
		expect(md.endsWith("b")).toBe(true);
	});
});

describe("extractTitle / stripTags / decodeEntities", () => {
	test("extractTitle decodes and normalises whitespace", () => {
		expect(extractTitle(page)).toBe("Bun & Docs");
		expect(extractTitle("<title>  a\n  b </title>")).toBe("a b");
		expect(extractTitle("<p>no title</p>")).toBeUndefined();
	});

	test("stripTags removes tags and decodes entities", () => {
		expect(stripTags("Bun is a <b>fast</b> runtime &amp; toolkit &#39;x&#x27; &nbsp;y")).toBe(
			"Bun is a fast runtime & toolkit 'x' y",
		);
	});

	test("decodeEntities leaves unknown entities alone", () => {
		expect(decodeEntities("a &zzz; b &lt;")).toBe("a &zzz; b <");
	});

	test("decodeEntities leaves a code point past U+10FFFF as written instead of throwing", () => {
		expect(decodeEntities("x &#x110000; &#99999999999; &#x1F600;")).toBe("x &#x110000; &#99999999999; 😀");
	});
});

describe("content types", () => {
	test.each([
		["text/html; charset=utf-8", true],
		["text/markdown", true],
		["application/json", true],
		["application/ld+json", true],
		["application/xml", true],
		["application/javascript", true],
		["application/x-yaml", true],
		["application/pdf", false],
		["image/png", false],
		["application/octet-stream", false],
	])("isTextContentType(%s) → %s", (type, expected) => {
		expect(isTextContentType(type)).toBe(expected);
	});

	test("isHtmlContentType", () => {
		expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
		expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
		expect(isHtmlContentType("text/plain")).toBe(false);
	});
});
