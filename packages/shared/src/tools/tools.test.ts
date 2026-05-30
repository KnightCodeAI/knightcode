import { describe, expect, test } from "bun:test";
import {
  ALL_TOOLS,
  getAITools,
  getDeferredTools,
  getDeferredToolNames,
} from "./index";

describe("deferred tool filtering", () => {
  test("getAITools(BUILD) excludes deferred tools by default", () => {
    const tools = getAITools("BUILD");
    expect(tools["WebFetch"]).toBeUndefined();
    expect(tools["WebSearch"]).toBeUndefined();
    expect(tools["NotebookEdit"]).toBeUndefined();
    expect(tools["TaskCreate"]).toBeUndefined();
    expect(tools["AskUserQuestion"]).toBeUndefined();
    expect(tools["EnterPlanMode"]).toBeUndefined();
    expect(tools["Read"]).toBeDefined();
    expect(tools["Bash"]).toBeDefined();
    expect(tools["TodoWrite"]).toBeDefined();
    expect(tools["Skill"]).toBeDefined();
    expect(tools["ToolSearch"]).toBeDefined();
  });

  test("getAITools(BUILD, { loaded_deferred }) includes named deferred tools", () => {
    const tools = getAITools("BUILD", {
      loaded_deferred: new Set(["WebFetch", "TaskCreate"]),
    });
    expect(tools["WebFetch"]).toBeDefined();
    expect(tools["TaskCreate"]).toBeDefined();
    expect(tools["WebSearch"]).toBeUndefined();
    expect(tools["NotebookEdit"]).toBeUndefined();
  });

  test("getAITools respects mode visibility even when loaded", () => {
    // ExitPlanMode is plan_only; loading it via deferred set must NOT
    // make it appear in BUILD mode.
    const tools = getAITools("BUILD", {
      loaded_deferred: new Set(["ExitPlanMode"]),
    });
    expect(tools["ExitPlanMode"]).toBeUndefined();
  });

  test("getDeferredTools returns exactly the deferred tools", () => {
    const names = getDeferredTools()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([
      "Agent",
      "AskUserQuestion",
      "Config",
      "EnterPlanMode",
      "ExitPlanMode",
      "NotebookEdit",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskOutput",
      "TaskStop",
      "TaskUpdate",
      "WebFetch",
      "WebSearch",
    ]);
  });

  test("Agent tool is registered and deferred in BUILD", () => {
    expect(ALL_TOOLS["Agent"]).toBeDefined();
    expect(getDeferredToolNames("BUILD")).toContain("Agent");
  });

  test("getDeferredToolNames filters by mode visibility", () => {
    const buildNames = getDeferredToolNames("BUILD").sort();
    // ExitPlanMode is plan_only — should NOT appear in BUILD
    expect(buildNames).not.toContain("ExitPlanMode");
    expect(buildNames).toContain("WebFetch");
    expect(buildNames).toContain("EnterPlanMode");

    const planNames = getDeferredToolNames("PLAN").sort();
    expect(planNames).toContain("ExitPlanMode");
    // NotebookEdit is build_only — should NOT appear in PLAN
    expect(planNames).not.toContain("NotebookEdit");
  });
});
