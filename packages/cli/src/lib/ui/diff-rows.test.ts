import { describe, expect, test } from "bun:test";
import { buildDiffRows } from "./diff-rows";

describe("buildDiffRows", () => {
  test("numbers context/added/removed lines", () => {
    const { rows, truncated } = buildDiffRows("a\nb\nc", "a\nB\nc");
    expect(truncated).toBe(false);
    // a (context), b removed, B added, c (context)
    expect(rows.map((r) => r.kind)).toEqual([
      "context",
      "removed",
      "added",
      "context",
    ]);
    const added = rows.find((r) => r.kind === "added")!;
    expect(added.text).toBe("B");
    expect(added.newNo).toBe(2);
    expect(added.oldNo).toBeUndefined();
    const removed = rows.find((r) => r.kind === "removed")!;
    expect(removed.oldNo).toBe(2);
    expect(removed.newNo).toBeUndefined();
  });

  test("truncates when over the line budget", () => {
    const big = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    const { rows, truncated } = buildDiffRows("", big, { maxLines: 10 });
    expect(truncated).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe("context");
    expect(rows[0]!.text).toContain("Diff too large");
  });
});
