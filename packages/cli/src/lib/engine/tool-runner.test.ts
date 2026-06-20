import { describe, expect, test } from "bun:test";
import { gateToolCall, ToolLoopGuard } from "./tool-runner";

const gate = (
  toolName: string,
  input: unknown,
  mode: "BUILD" | "PLAN" | "AUTO" = "BUILD",
  opts?: { alwaysAllowEdits?: boolean; isCommandAllowed?: (c: string) => boolean },
) =>
  gateToolCall({
    toolName,
    input,
    mode,
    alwaysAllowEdits: opts?.alwaysAllowEdits ?? false,
    isCommandAllowed: opts?.isCommandAllowed ?? (() => false),
  });

describe("gateToolCall", () => {
  test("TodoWrite is always 'todo'", () => {
    expect(gate("TodoWrite", { todos: [] })).toBe("todo");
    expect(gate("TodoWrite", { todos: [] }, "AUTO")).toBe("todo");
  });

  test("file edits need confirmation unless alwaysAllowEdits or AUTO", () => {
    for (const t of ["Edit", "MultiEdit", "Write", "NotebookEdit"]) {
      expect(gate(t, {})).toBe("confirm");
      expect(gate(t, {}, "AUTO")).toBe("execute");
      expect(gate(t, {}, "BUILD", { alwaysAllowEdits: true })).toBe("execute");
    }
  });

  test("Bash gated by allowlist outside AUTO", () => {
    expect(gate("Bash", { command: "rm -rf x" })).toBe("confirm");
    expect(
      gate("Bash", { command: "ls" }, "BUILD", { isCommandAllowed: () => true }),
    ).toBe("execute");
    expect(gate("Bash", { command: "rm -rf x" }, "AUTO")).toBe("execute");
  });

  test("AskUserQuestion always confirms (question), even in AUTO", () => {
    expect(gate("AskUserQuestion", {})).toBe("confirm");
    expect(gate("AskUserQuestion", {}, "AUTO")).toBe("confirm");
  });

  test("Config: writes confirm, reads execute", () => {
    expect(gate("Config", { key: "model", value: "x" })).toBe("confirm");
    expect(gate("Config", { key: "model" })).toBe("execute");
    expect(gate("Config", { key: "model", value: "x" }, "AUTO")).toBe("execute");
  });

  test("Agent confirms outside AUTO", () => {
    expect(gate("Agent", {})).toBe("confirm");
    expect(gate("Agent", {}, "AUTO")).toBe("execute");
  });

  test("read-only tools execute", () => {
    expect(gate("Read", { file_path: "x" })).toBe("execute");
    expect(gate("Grep", { pattern: "x" })).toBe("execute");
  });
});

describe("ToolLoopGuard", () => {
  test("rejects the 4th identical call; TodoWrite exempt", () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 3; i++) {
      expect(guard.check("Grep", { pattern: "x" })).toBe(true);
    }
    expect(guard.check("Grep", { pattern: "x" })).toBe(false);
    expect(guard.check("Grep", { pattern: "y" })).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(guard.check("TodoWrite", { todos: [] })).toBe(true);
    }
  });

  test("reset clears counts", () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 4; i++) guard.check("Grep", { pattern: "x" });
    guard.reset();
    expect(guard.check("Grep", { pattern: "x" })).toBe(true);
  });
});
