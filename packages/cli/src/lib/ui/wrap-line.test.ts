import { describe, expect, test } from "bun:test";
import { wrapText, wrapSpans } from "./wrap-line";

describe("wrapText", () => {
  test("short line stays on one row", () => {
    expect(wrapText("abc", 10)).toEqual(["abc"]);
    expect(wrapText("exactly-ten", 11)).toEqual(["exactly-ten"]);
  });
  test("long line breaks into N rows", () => {
    expect(wrapText("a".repeat(25), 10)).toEqual([
      "aaaaaaaaaa",
      "aaaaaaaaaa",
      "aaaaa",
    ]);
  });
  test("preserves leading indent on continuation rows", () => {
    const rows = wrapText("  " + "x".repeat(20), 10);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toBe("  xxxxxxxx");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.startsWith("  ")).toBe(true);
    }
  });
  test("width <= 0 is a no-op", () => {
    expect(wrapText("abc", 0)).toEqual(["abc"]);
  });
});

describe("wrapSpans", () => {
  test("keeps a short run on one row", () => {
    const spans = [{ text: "const ", fg: "k" }, { text: "x", fg: "v" }];
    expect(wrapSpans(spans, 80)).toEqual([spans]);
  });
  test("splits spans across rows, preserving styling", () => {
    const spans = [{ text: "abcdef", fg: "a" }, { text: "ghij", fg: "b" }];
    const rows = wrapSpans(spans, 4);
    expect(rows).toEqual([
      [{ text: "abcd", fg: "a" }],
      [{ text: "ef", fg: "a" }, { text: "gh", fg: "b" }],
      [{ text: "ij", fg: "b" }],
    ]);
  });
  test("empty input yields one empty row", () => {
    expect(wrapSpans([], 10)).toEqual([[]]);
  });
});
