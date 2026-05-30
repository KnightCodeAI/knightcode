import { describe, test, expect } from "bun:test";
import { computeLineDiff } from "./diff";

describe("Diff line utility", () => {
  test("computes correct addition and deletion changes", () => {
    const oldStr = "line 1\nline 2\nline 3";
    const newStr = "line 1\nline 2 updated\nline 3\nline 4";

    const diff = computeLineDiff(oldStr, newStr);

    expect(diff).toEqual([
      { type: "unchanged", content: "line 1" },
      { type: "deleted", content: "line 2" },
      { type: "added", content: "line 2 updated" },
      { type: "unchanged", content: "line 3" },
      { type: "added", content: "line 4" },
    ]);
  });

  test("handles empty input", () => {
    const diff = computeLineDiff("", "");
    expect(diff).toEqual([{ type: "unchanged", content: "" }]);
  });
});
