import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { hasIncompleteTasksSync } from "./task-store";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("hasIncompleteTasksSync", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kc_taskstore_"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeTasks(tasks: Array<{ status: string }>) {
    const dir = join(root, ".knightcode");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({ next_id: tasks.length + 1, tasks }),
      "utf-8",
    );
  }

  test("returns false when no tasks file exists", () => {
    expect(hasIncompleteTasksSync(root)).toBe(false);
  });

  test("returns false when all tasks are completed", async () => {
    await writeTasks([{ status: "completed" }, { status: "completed" }]);
    expect(hasIncompleteTasksSync(root)).toBe(false);
  });

  test("returns true when a pending task exists", async () => {
    await writeTasks([{ status: "completed" }, { status: "pending" }]);
    expect(hasIncompleteTasksSync(root)).toBe(true);
  });

  test("returns true when an in_progress task exists", async () => {
    await writeTasks([{ status: "in_progress" }]);
    expect(hasIncompleteTasksSync(root)).toBe(true);
  });

  test("returns false on malformed json", async () => {
    const dir = join(root, ".knightcode");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "tasks.json"), "{ not valid", "utf-8");
    expect(hasIncompleteTasksSync(root)).toBe(false);
  });
});
