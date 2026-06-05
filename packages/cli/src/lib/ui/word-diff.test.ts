import { describe, expect, test } from "bun:test";
import { wordDiff } from "./word-diff";

describe("wordDiff", () => {
  test("flags only the changed word, keeps the rest common", () => {
    const { removed, added } = wordDiff(
      "const oldName = 1;",
      "const newName = 1;",
    );
    expect(removed.filter((s) => s.changed).map((s) => s.text)).toEqual([
      "oldName",
    ]);
    expect(added.filter((s) => s.changed).map((s) => s.text)).toEqual([
      "newName",
    ]);
    // Common prefix/suffix preserved on both sides.
    expect(removed.map((s) => s.text).join("")).toBe("const oldName = 1;");
    expect(added.map((s) => s.text).join("")).toBe("const newName = 1;");
  });

  test("identical lines yield no changed segments", () => {
    const { removed, added } = wordDiff("same line", "same line");
    expect(removed.every((s) => !s.changed)).toBe(true);
    expect(added.every((s) => !s.changed)).toBe(true);
  });

  test("fully different lines mark everything changed", () => {
    const { removed, added } = wordDiff("aaa", "bbb");
    expect(removed).toEqual([{ text: "aaa", changed: true }]);
    expect(added).toEqual([{ text: "bbb", changed: true }]);
  });
});
