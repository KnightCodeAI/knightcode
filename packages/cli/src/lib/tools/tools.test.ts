import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { executeLocalTool } from "./index";
import { Mode } from "@knightcode/shared";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

describe("tools dispatcher", () => {
  let tempDir: string;
  let testFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(process.cwd(), "temp_tools_test_"));
    testFile = join(tempDir, "sample.txt");
  });

  afterAll(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("Read returns file contents", async () => {
    await writeFile(testFile, "hello\nworld", "utf-8");
    const res = (await executeLocalTool(
      "Read",
      { file_path: testFile },
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(res.content).toBe("hello\nworld");
  });

  test("Edit replaces single occurrence", async () => {
    await writeFile(testFile, "apple bananana cherry", "utf-8");
    const res = (await executeLocalTool(
      "Edit",
      {
        file_path: testFile,
        old_string: "bananana",
        new_string: "banana",
        replace_all: false,
      },
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(res.success).toBe(true);
    expect(res.replacements).toBe(1);
  });

  test("Edit rejects ambiguous match without replace_all", async () => {
    await writeFile(testFile, "hello hello hello", "utf-8");
    expect(
      executeLocalTool(
        "Edit",
        {
          file_path: testFile,
          old_string: "hello",
          new_string: "hi",
          replace_all: false,
        },
        Mode.BUILD,
        "test-session",
      ),
    ).rejects.toThrow(/ambiguous/);
  });

  test("MultiEdit applies edits sequentially and atomically", async () => {
    await writeFile(testFile, "alpha bravo charlie", "utf-8");
    const res = (await executeLocalTool(
      "MultiEdit",
      {
        file_path: testFile,
        edits: [
          { old_string: "alpha", new_string: "A", replace_all: false },
          { old_string: "bravo", new_string: "B", replace_all: false },
        ],
      },
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(res.success).toBe(true);
    expect(res.edits_applied).toBe(2);
    const content = await Bun.file(testFile).text();
    expect(content).toBe("A B charlie");
  });

  test("MultiEdit rolls back when a later edit fails", async () => {
    await writeFile(testFile, "alpha bravo charlie", "utf-8");
    expect(
      executeLocalTool(
        "MultiEdit",
        {
          file_path: testFile,
          edits: [
            { old_string: "alpha", new_string: "A", replace_all: false },
            { old_string: "DOES_NOT_EXIST", new_string: "X", replace_all: false },
          ],
        },
        Mode.BUILD,
        "test-session",
      ),
    ).rejects.toThrow(/not found/);
    const content = await Bun.file(testFile).text();
    expect(content).toBe("alpha bravo charlie");
  });

  test("TodoWrite rejects more than one in_progress", async () => {
    expect(
      executeLocalTool(
        "TodoWrite",
        {
          todos: [
            { content: "a", active_form: "A", status: "in_progress" },
            { content: "b", active_form: "B", status: "in_progress" },
          ],
        },
        Mode.BUILD,
        "test-session",
      ),
    ).rejects.toThrow(/in_progress/);
  });

  test("Glob returns matching files", async () => {
    const res = (await executeLocalTool(
      "Glob",
      { pattern: "**/sample.txt", path: tempDir },
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(res.numFiles).toBeGreaterThan(0);
  });

  test("Unknown tool returns helpful error", async () => {
    expect(
      executeLocalTool("doesNotExist", {}, Mode.BUILD, "test-session"),
    ).rejects.toThrow(/Unknown tool/);
  });

  test("PLAN mode blocks Write", async () => {
    expect(
      executeLocalTool(
        "Write",
        { file_path: testFile, content: "x" },
        Mode.PLAN,
        "test-session",
      ),
    ).rejects.toThrow(/not available in PLAN/);
  });
});
