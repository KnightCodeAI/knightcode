import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Markdown } from "@/lib/markdown";

function html(text: string): string {
	return renderToStaticMarkup(<Markdown text={text} />);
}

describe("Markdown", () => {
	test("renders the common shapes as elements", () => {
		const out = html("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n```ts\nlet x = 1;\n```");
		expect(out).toContain("<h1>Title</h1>");
		expect(out).toContain("<strong>bold</strong>");
		expect(out).toContain("<code>code</code>");
		expect(out).toContain("<li>one</li>");
		expect(out).toContain('<pre data-lang="ts"><code>let x = 1;</code></pre>');
	});

	test("never emits markup it did not write", () => {
		const out = html('<script>alert(1)</script>\n\nsee <b>this</b> and `<i>` and [x](javascript:alert(1)) and [ok](https://a.b)');
		expect(out).not.toContain("<script>");
		expect(out).not.toContain("<b>");
		expect(out).not.toContain("<i>");
		expect(out).toContain("&lt;script&gt;");
		expect(out).toContain("<code>&lt;i&gt;</code>");
		expect(out).not.toContain("javascript:");
		expect(out).toContain('href="https://a.b"');
	});
});
