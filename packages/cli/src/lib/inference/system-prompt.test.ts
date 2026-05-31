import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  test("BUILD mode names the build section and Write tool", () => {
    const p = buildSystemPrompt({ mode: "BUILD" });
    expect(p).toContain("Mode: BUILD");
    expect(p).toContain("Write");
  });

  test("PLAN mode is read-only and omits the build section", () => {
    const p = buildSystemPrompt({ mode: "PLAN" });
    expect(p).toContain("Mode: PLAN");
    expect(p).not.toContain("Mode: BUILD");
  });

  test("lists available deferred tools in a system-reminder", () => {
    const p = buildSystemPrompt({
      mode: "BUILD",
      availableDeferredTools: ["WebSearch", "WebFetch"],
    });
    expect(p).toContain("<system-reminder>");
    expect(p).toContain("WebSearch");
  });
});
