import { describe, expect, test } from "bun:test";
import { extractLoadedDeferredTools } from "./loaded-deferred-tools";

describe("extractLoadedDeferredTools", () => {
  test("collects names from a successful ToolSearch output (typed part)", () => {
    const loaded = extractLoadedDeferredTools([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "tool-ToolSearch",
            state: "output-available",
            output: { matches: [{ name: "WebSearch" }, { name: "WebFetch" }] },
          },
        ],
      } as any,
    ]);
    expect(loaded).toEqual(new Set(["WebSearch", "WebFetch"]));
  });

  test("collects from a dynamic-tool ToolSearch part", () => {
    const loaded = extractLoadedDeferredTools([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "ToolSearch",
            state: "output-available",
            output: { matches: [{ name: "NotebookEdit" }] },
          },
        ],
      } as any,
    ]);
    expect(loaded).toEqual(new Set(["NotebookEdit"]));
  });

  test("ignores non-output-available ToolSearch parts and other tools", () => {
    const loaded = extractLoadedDeferredTools([
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "tool-ToolSearch", state: "input-available" },
          {
            type: "tool-Read",
            state: "output-available",
            output: { matches: [{ name: "Nope" }] },
          },
        ],
      } as any,
    ]);
    expect(loaded.size).toBe(0);
  });
});
