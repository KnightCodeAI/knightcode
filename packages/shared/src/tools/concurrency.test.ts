import { describe, expect, test } from "bun:test";
import { ALL_TOOLS, ALL_TOOL_NAMES } from "./index";

// Locked Phase-2 concurrency table (query-engine design spec). Agent being
// safe is what makes subagents parallel; Config writes settings; the Task*
// mutators write the task store; mode-transition tools mutate gating for
// subsequent calls. TodoWrite is unsafe for the same reason as the Task*
// mutators — it rewrites the shared todo list.
const CONCURRENCY_SAFE = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "ToolSearch",
  "Skill",
  "Agent",
]);

describe("is_concurrency_safe flags", () => {
  test("every tool matches the locked scheduler table", () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(`${name}:${ALL_TOOLS[name]!.is_concurrency_safe}`).toBe(
        `${name}:${CONCURRENCY_SAFE.has(name)}`,
      );
    }
  });

  test("table covers exactly the registered tools (no drift)", () => {
    for (const name of CONCURRENCY_SAFE) {
      expect(ALL_TOOL_NAMES).toContain(name);
    }
  });
});
