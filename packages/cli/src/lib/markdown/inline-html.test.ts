import { describe, expect, test } from "bun:test";
import { convertHtmlBreaks } from "./inline-html";

describe("convertHtmlBreaks", () => {
  test("mid-line br becomes a hard line break", () => {
    expect(convertHtmlBreaks("first<br>second")).toBe("first  \nsecond");
    expect(convertHtmlBreaks("a<br/>b<br />c<BR>d")).toBe("a  \nb  \nc  \nd");
  });

  test("br at end of line uses the existing newline for the break", () => {
    expect(convertHtmlBreaks("first<br>\nsecond")).toBe("first  \nsecond");
  });

  test("table body row expands into continuation rows", () => {
    const input = [
      "| Script | What it does |",
      "|---|---|",
      "| `build.ts` | • builds binaries<br>• embeds version |",
    ].join("\n");
    expect(convertHtmlBreaks(input)).toBe(
      [
        "| Script | What it does |",
        "|---|---|",
        "| `build.ts` | • builds binaries |",
        "|  | • embeds version |",
      ].join("\n"),
    );
  });

  test("breaks in multiple columns align segment by segment", () => {
    expect(convertHtmlBreaks("| one<br>two | three<br/>four<br>five |")).toBe(
      ["| one | three |", "| two | four |", "|  | five |"].join("\n"),
    );
  });

  test("header row joins with a space (single header line only)", () => {
    const input = ["| Long<br>header | b |", "|---|---|", "| x | y |"].join(
      "\n",
    );
    expect(convertHtmlBreaks(input)).toBe(
      ["| Long header | b |", "|---|---|", "| x | y |"].join("\n"),
    );
  });

  test("inline code spans are preserved, in prose and cells", () => {
    expect(convertHtmlBreaks("use `<br>` for line breaks<br>ok")).toBe(
      "use `<br>` for line breaks  \nok",
    );
    expect(convertHtmlBreaks("| `a<br>b` | c<br>d |")).toBe(
      ["| `a<br>b` | c |", "|  | d |"].join("\n"),
    );
  });

  test("multi-backtick code spans preserve an inner <br>", () => {
    expect(convertHtmlBreaks("see ``a `<br>` b`` then<br>next")).toBe(
      "see ``a `<br>` b`` then  \nnext",
    );
    expect(convertHtmlBreaks("| ``x<br>y`` | c<br>d |")).toBe(
      ["| ``x<br>y`` | c |", "|  | d |"].join("\n"),
    );
  });

  test("body row without a trailing pipe still expands its breaks", () => {
    // Previously a missing trailing pipe forced the fallback that degraded
    // <br> to a space; now the row expands into continuation rows.
    expect(convertHtmlBreaks("| a | b<br>c")).toBe(
      ["| a | b |", "|  | c |"].join("\n"),
    );
  });

  test("a literal pipe inside a code span is not a column separator", () => {
    expect(convertHtmlBreaks("| `a | b` | c<br>d |")).toBe(
      ["| `a | b` | c |", "|  | d |"].join("\n"),
    );
  });

  test("an escaped pipe stays inside its cell", () => {
    expect(convertHtmlBreaks("| a \\| b | c<br>d |")).toBe(
      ["| a \\| b | c |", "|  | d |"].join("\n"),
    );
  });

  test("other text untouched", () => {
    expect(convertHtmlBreaks("a < b and Promise<void>")).toBe(
      "a < b and Promise<void>",
    );
    const plainTable = "| a | b |\n|---|---|\n| x | y |";
    expect(convertHtmlBreaks(plainTable)).toBe(plainTable);
  });
});
