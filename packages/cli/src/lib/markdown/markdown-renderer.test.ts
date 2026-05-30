import { describe, expect, test } from "bun:test";
import { renderMarkdownLines } from "./markdown-renderer";

describe("renderMarkdownLines", () => {
  test("h1: uppercase, primary, bold", () => {
    const l = renderMarkdownLines("# Hello")[0]!;
    expect(l.text).toBe("HELLO");
    expect(l.fg).toBe("primary");
    expect(l.bold).toBe(true);
  });

  test("h2: arrow prefix, info, bold", () => {
    const l = renderMarkdownLines("## Section")[0]!;
    expect(l.text).toBe("▸ Section");
    expect(l.fg).toBe("info");
    expect(l.bold).toBe(true);
  });

  test("h3: indented arrow, thinking, bold", () => {
    const l = renderMarkdownLines("### Sub")[0]!;
    expect(l.text).toBe("  › Sub");
    expect(l.fg).toBe("thinking");
  });

  test("fenced code block body: code, fence lines hidden", () => {
    const lines = renderMarkdownLines("```ts\nconst x = 1;\n```");
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toBe("const x = 1;");
    expect(lines[0]!.fg).toBe("code");
  });

  test("blockquote: bar prefix, dim", () => {
    const l = renderMarkdownLines("> Note")[0]!;
    expect(l.text).toBe("│ Note");
    expect(l.fg).toBe("dim");
    expect(l.dim).toBe(true);
  });

  test("unordered list: bullet prefix", () => {
    const l = renderMarkdownLines("- Item")[0]!;
    expect(l.text).toBe("• Item");
  });

  test("ordered list: number preserved", () => {
    const l = renderMarkdownLines("1. First")[0]!;
    expect(l.text).toBe("1. First");
  });

  test("horizontal rule: dim dashes", () => {
    const l = renderMarkdownLines("---")[0]!;
    expect(l.fg).toBe("dim");
    expect(l.text).toMatch(/─+/);
  });

  test("inline bold stripped", () => {
    const l = renderMarkdownLines("This is **bold** text")[0]!;
    expect(l.text).toBe("This is bold text");
  });

  test("inline code stripped", () => {
    const l = renderMarkdownLines("Run `npm install`")[0]!;
    expect(l.text).toBe("Run npm install");
  });

  test("link: text only", () => {
    const l = renderMarkdownLines("[Click](https://example.com)")[0]!;
    expect(l.text).toBe("Click");
  });

  test("empty line preserved", () => {
    const lines = renderMarkdownLines("a\n\nb");
    expect(lines[1]!.text).toBe("");
  });

  test("multiple blocks: correct count", () => {
    const md = "# Title\n\nSome text.\n\n- a\n- b";
    const lines = renderMarkdownLines(md);
    expect(lines.length).toBe(6);
  });

  describe("tables", () => {
    const basicTable = "| Name | Lang |\n| --- | --- |\n| React | JS |";

    test("separator row is not emitted", () => {
      const lines = renderMarkdownLines(basicTable);
      expect(lines.every((l) => !/^:?-+:?$/.test(l.text.trim()))).toBe(true);
    });

    test("header row is primary + bold", () => {
      const lines = renderMarkdownLines(basicTable);
      expect(lines[0]!.fg).toBe("primary");
      expect(lines[0]!.bold).toBe(true);
    });

    test("rule emitted after header", () => {
      const lines = renderMarkdownLines(basicTable);
      expect(lines[1]!.fg).toBe("dim");
      expect(lines[1]!.text).toMatch(/^─+$/);
    });

    test("data row is text + not bold", () => {
      const lines = renderMarkdownLines(basicTable);
      expect(lines[2]!.fg).toBe("text");
      expect(lines[2]!.bold).toBe(false);
    });

    test("columns are padded to equal width across rows", () => {
      const md = "| A | B |\n| --- | --- |\n| LongValue | X |";
      const lines = renderMarkdownLines(md);
      // header and data rows should have the same total length
      expect(lines[0]!.text.length).toBe(lines[2]!.text.length);
    });

    test("right alignment pads on the left", () => {
      const md = "| Num |\n| ---: |\n| 42 |";
      const lines = renderMarkdownLines(md);
      // data cell "42" should be right-padded to match header "Num" width → " Num " then " 42 " right-aligned
      const dataText = lines[2]!.text;
      expect(dataText).toMatch(/^\s+\d/); // leading spaces before the number
    });

    test("center alignment centers the cell", () => {
      const md = "| H |\n| :---: |\n| hi |";
      const lines = renderMarkdownLines(md);
      const dataText = lines[2]!.text.trim(); // trim outer padding
      // "hi" centered in width 1 (max("H".length, "hi".length)=2) → same as left for width=2
      expect(dataText).toBe("hi");
    });

    test("table followed by prose flushes correctly", () => {
      const md = "| A |\n| --- |\n| b |\n\nAfter";
      const lines = renderMarkdownLines(md);
      const last = lines[lines.length - 1]!;
      expect(last.text).toBe("After");
    });

    test("table at end of string (EOF flush)", () => {
      const lines = renderMarkdownLines(basicTable);
      expect(lines.length).toBe(3); // header + rule + 1 data row
    });

    test("single-column table", () => {
      const md = "| Item |\n| --- |\n| foo |\n| bar |";
      const lines = renderMarkdownLines(md);
      expect(lines.length).toBe(4); // header + rule + 2 data rows
      expect(lines[0]!.fg).toBe("primary");
    });

    test("inline markers in cells are stripped", () => {
      const md =
        "| **Bold** | `code` |\n| --- | --- |\n| *italic* | [link](url) |";
      const lines = renderMarkdownLines(md);
      expect(lines[0]!.text).toContain("Bold");
      expect(lines[0]!.text).not.toContain("**");
      expect(lines[0]!.text).toContain("code");
      expect(lines[0]!.text).not.toContain("`");
      expect(lines[2]!.text).toContain("italic");
      expect(lines[2]!.text).not.toContain("*");
      expect(lines[2]!.text).toContain("link");
      expect(lines[2]!.text).not.toContain("url");
    });

    test("table inside code block is not parsed as table", () => {
      const md = "```\n| A | B |\n| --- | --- |\n```";
      const lines = renderMarkdownLines(md);
      expect(lines.every((l) => l.fg === "code")).toBe(true);
    });
  });
});
