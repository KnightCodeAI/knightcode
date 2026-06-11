import { describe, expect, test } from "bun:test";
import { stripHtmlBreaks } from "./inline-html";

describe("stripHtmlBreaks", () => {
  test("replaces br variants with a space", () => {
    expect(stripHtmlBreaks("a<br>b<br/>c<br />d<BR>e")).toBe("a b c d e");
  });

  test("table cells lose the literal tag", () => {
    expect(stripHtmlBreaks("| builds binaries<br>cross-platform |")).toBe(
      "| builds binaries cross-platform |",
    );
  });

  test("inline code spans are preserved", () => {
    expect(stripHtmlBreaks("use `<br>` for line breaks<br>ok")).toBe(
      "use `<br>` for line breaks ok",
    );
  });

  test("other text untouched", () => {
    expect(stripHtmlBreaks("a < b and Promise<void>")).toBe(
      "a < b and Promise<void>",
    );
  });
});
