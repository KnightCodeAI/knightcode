// packages/cli/src/lib/ui/tool-presentation.test.ts
import { describe, expect, test } from "bun:test";
import {
  formatToolName,
  summarizeToolInput,
  toolStatus,
} from "./tool-presentation";

describe("formatToolName", () => {
  test("splits camelCase and capitalizes", () => {
    expect(formatToolName("TodoWrite")).toBe("Todo Write");
    expect(formatToolName("WebFetch")).toBe("Web Fetch");
    expect(formatToolName("Read")).toBe("Read");
  });
});

describe("summarizeToolInput", () => {
  test("file tools show the path", () => {
    expect(summarizeToolInput("Read", { file_path: "src/a.ts" })).toBe(
      "src/a.ts",
    );
    expect(
      summarizeToolInput("Write", { file_path: "src/a.ts", content: "abcde" }),
    ).toBe("src/a.ts (5 chars)");
    expect(summarizeToolInput("Edit", { file_path: "src/a.ts" })).toBe(
      "src/a.ts",
    );
  });

  test("command/query tools show their key field", () => {
    expect(summarizeToolInput("Bash", { command: "ls -la" })).toBe("ls -la");
    expect(summarizeToolInput("Grep", { pattern: "foo.*bar" })).toBe(
      "foo.*bar",
    );
    expect(summarizeToolInput("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(summarizeToolInput("WebFetch", { url: "https://x.dev" })).toBe(
      "https://x.dev",
    );
    expect(summarizeToolInput("WebSearch", { query: "bun sqlite" })).toBe(
      "bun sqlite",
    );
  });

  test("TodoWrite reports completed/total", () => {
    expect(
      summarizeToolInput("TodoWrite", {
        todos: [{ status: "completed" }, { status: "pending" }],
      }),
    ).toBe("checklist (1/2 completed)");
  });

  test("Agent shows subagent + description", () => {
    expect(
      summarizeToolInput("Agent", {
        subagent_type: "Explore",
        description: "find callers",
      }),
    ).toBe("Explore — find callers");
  });

  test("unknown shapes fall back to joined values, single line", () => {
    expect(summarizeToolInput("Mystery", { a: 1, b: "two" })).toBe("1 two");
    expect(summarizeToolInput("Mystery", null)).toBe("");
  });

  test("long summaries are truncated with an ellipsis", () => {
    const long = "x".repeat(200);
    const out = summarizeToolInput("Bash", { command: long });
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("toolStatus", () => {
  test("maps part.state to a status", () => {
    expect(toolStatus({ state: "input-streaming" } as any)).toBe("running");
    expect(toolStatus({ state: "input-available" } as any)).toBe("running");
    expect(toolStatus({ state: "output-available" } as any)).toBe("success");
    expect(toolStatus({ state: "output-error" } as any)).toBe("error");
  });
});
