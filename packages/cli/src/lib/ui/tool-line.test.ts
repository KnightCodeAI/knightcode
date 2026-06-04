import { describe, expect, test } from "bun:test";
import { toolCallLine, toolResultSummary } from "./tool-line";

describe("toolCallLine", () => {
  test("Name(primaryArg) form", () => {
    expect(toolCallLine("Read", { file_path: "src/a.ts" })).toBe("Read(src/a.ts)");
    expect(toolCallLine("Bash", { command: "ls -la" })).toBe("Bash(ls -la)");
    expect(toolCallLine("Grep", { pattern: "foo" })).toBe('Grep("foo")');
    expect(toolCallLine("Edit", { file_path: "src/a.ts" })).toBe("Edit(src/a.ts)");
  });
  test("truncates long args", () => {
    expect(toolCallLine("Bash", { command: "x".repeat(200) }).length).toBeLessThanOrEqual(72);
  });
});

describe("toolResultSummary", () => {
  test("string output → first-line + line count", () => {
    expect(toolResultSummary("Read", { file_path: "a" }, "l1\nl2\nl3")).toBe("Read 3 lines");
  });
  test("error → the error text", () => {
    expect(toolResultSummary("Bash", {}, undefined, "boom")).toBe("boom");
  });
  test("no output yet → empty", () => {
    expect(toolResultSummary("Read", {}, undefined)).toBe("");
  });
});
