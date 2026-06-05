import { describe, expect, test } from "bun:test";
import { diffSummary } from "./diff-summary";

describe("diffSummary", () => {
  test("counts a changed line as one add + one remove", () => {
    expect(diffSummary("a\nb\nc", "a\nB\nc")).toEqual({
      additions: 1,
      removals: 1,
    });
  });
  test("counts a pure addition", () => {
    expect(diffSummary("a\nb", "a\nb\nc")).toEqual({
      additions: 1,
      removals: 0,
    });
  });
  test("counts a pure removal", () => {
    expect(diffSummary("a\nb\nc", "a\nc")).toEqual({
      additions: 0,
      removals: 1,
    });
  });
});
