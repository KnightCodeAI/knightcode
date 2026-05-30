import { describe, expect, test } from "bun:test";
import { extractLoadedDeferredTools } from "./loaded-deferred-tools";

function toolSearchPart(
  toolCallId: string,
  matches: Array<{ name: string }>,
  state:
    | "output-available"
    | "output-error"
    | "input-available" = "output-available",
) {
  return {
    type: "tool-ToolSearch" as const,
    toolCallId,
    state,
    input: { query: "" },
    output:
      state === "output-available"
        ? { query: "", matches, total_deferred_tools: 12 }
        : undefined,
  };
}

function assistantMsg(id: string, parts: any[]) {
  return { id, role: "assistant" as const, parts };
}

describe("extractLoadedDeferredTools", () => {
  test("returns empty set when no ToolSearch calls present", () => {
    const result = extractLoadedDeferredTools([
      assistantMsg("a1", [{ type: "text", text: "hello" }]),
    ]);
    expect([...result]).toEqual([]);
  });

  test("collects names from successful ToolSearch outputs", () => {
    const result = extractLoadedDeferredTools([
      assistantMsg("a1", [
        toolSearchPart("t1", [{ name: "WebFetch" }, { name: "WebSearch" }]),
      ]),
      assistantMsg("a2", [
        toolSearchPart("t2", [{ name: "NotebookEdit" }]),
      ]),
    ]);
    expect([...result].sort()).toEqual([
      "NotebookEdit",
      "WebFetch",
      "WebSearch",
    ]);
  });

  test("ignores ToolSearch calls in non-output-available states", () => {
    const result = extractLoadedDeferredTools([
      assistantMsg("a1", [
        toolSearchPart("t1", [{ name: "WebFetch" }], "input-available"),
        toolSearchPart("t2", [{ name: "WebSearch" }], "output-error"),
      ]),
    ]);
    expect([...result]).toEqual([]);
  });

  test("handles dynamic-tool variant", () => {
    const result = extractLoadedDeferredTools([
      assistantMsg("a1", [
        {
          type: "dynamic-tool",
          toolName: "ToolSearch",
          toolCallId: "t1",
          state: "output-available",
          input: { query: "" },
          output: {
            query: "",
            matches: [{ name: "TaskCreate" }],
            total_deferred_tools: 12,
          },
        },
      ]),
    ]);
    expect([...result]).toEqual(["TaskCreate"]);
  });

  test("dedupes across multiple loads", () => {
    const result = extractLoadedDeferredTools([
      assistantMsg("a1", [toolSearchPart("t1", [{ name: "WebFetch" }])]),
      assistantMsg("a2", [toolSearchPart("t2", [{ name: "WebFetch" }])]),
    ]);
    expect([...result]).toEqual(["WebFetch"]);
  });
});
