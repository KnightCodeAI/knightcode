import { describe, expect, test } from "bun:test";
import { convertHtmlBreaks } from "./inline-html";

describe("convertHtmlBreaks", () => {
  test("mid-line br becomes a hard line break", () => {
    expect(convertHtmlBreaks("first<br>second")).toBe("first  \nsecond");
    expect(convertHtmlBreaks("a<br/>b<br />c<BR>d")).toBe(
      "a  \nb  \nc  \nd",
    );
  });

  test("br at end of line uses the existing newline for the break", () => {
    expect(convertHtmlBreaks("first<br>\nsecond")).toBe("first  \nsecond");
  });

  test("table cells get a space, never a newline", () => {
    expect(convertHtmlBreaks("| builds binaries<br>cross-platform |")).toBe(
      "| builds binaries cross-platform |",
    );
    expect(
      convertHtmlBreaks("| a | b |\n| one<br>two | three<br/>four |"),
    ).toBe("| a | b |\n| one two | three four |");
  });

  test("inline code spans are preserved", () => {
    expect(convertHtmlBreaks("use `<br>` for line breaks<br>ok")).toBe(
      "use `<br>` for line breaks  \nok",
    );
  });

  test("other text untouched", () => {
    expect(convertHtmlBreaks("a < b and Promise<void>")).toBe(
      "a < b and Promise<void>",
    );
  });
});
