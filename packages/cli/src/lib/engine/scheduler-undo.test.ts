import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolCallRequest, ToolHost } from "./events";
import { NOOP_ENGINE_HOOKS } from "./hooks";
import { ToolLoopGuard } from "./tool-runner";
import { runToolCalls } from "./scheduler";
import { executeRegisteredTool, undoSessionChanges } from "../tools";

describe("scheduler preserves /undo snapshots", () => {
  test("Edit via the scheduler records original content; undo restores it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-undo-"));
    const file = join(dir, "target.txt");
    writeFileSync(file, "original content\n", "utf-8");
    const sessionId = `undo-test-${Date.now()}`;

    const host: ToolHost = {
      executeTool: (toolCall, mode, opts) =>
        executeRegisteredTool(toolCall.toolName, toolCall.input, mode, sessionId, {
          cwd: dir,
          modelOverride: opts.modelOverride,
        }),
      canUseTool: async () => ({ behavior: "allow" }),
      askQuestion: async () => ({ answers: [] }),
      isCommandAllowed: () => false,
      onAlwaysAllowBash: () => {},
    };

    // Read before editing so the read-before-write ledger guard is satisfied.
    await executeRegisteredTool("Read", { file_path: file }, "BUILD", sessionId, {
      cwd: dir,
    });

    const toolCalls: ToolCallRequest[] = [
      {
        toolCallId: "e1",
        toolName: "Edit",
        input: {
          file_path: file,
          old_string: "original content",
          new_string: "edited content",
        },
      },
    ];

    let allow = false;
    const gen = runToolCalls({
      toolCalls,
      host,
      hooks: NOOP_ENGINE_HOOKS,
      getMode: () => "BUILD",
      loopGuard: new ToolLoopGuard(),
      alwaysAllowEdits: { get: () => allow, set: (v) => (allow = v) },
    });
    while (!(await gen.next()).done) {
      // drain
    }

    expect(readFileSync(file, "utf-8")).toContain("edited content");
    const { revertedFiles, failedFiles } = await undoSessionChanges(sessionId);
    expect(failedFiles).toEqual([]);
    expect(revertedFiles.length).toBe(1);
    expect(readFileSync(file, "utf-8")).toBe("original content\n");
  });
});
