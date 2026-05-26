import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { executeLocalTool, undoSessionChanges } from "./local-tools";
import { Mode } from "@knightcode/shared";
import { writeFile, unlink, mkdir, mkdtemp, rm } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { spawnSync } from "child_process";
import {
  getWorktreeStatus,
  isWorktreeDisabled,
  setWorktreeDisabled,
} from "./worktree-tools";

describe("local-tools tool functioning", () => {
  let tempDir: string;
  let testFile: string;
  let pngFile: string;
  let testRevertFile: string;
  let previousDisableWorktrees: string | undefined;

  beforeAll(async () => {
    previousDisableWorktrees = process.env.KNIGHTCODE_DISABLE_WORKTREES;
    process.env.KNIGHTCODE_DISABLE_WORKTREES = "1";

    // Create a unique temp directory inside process.cwd() so it passes CWD resolution checks
    tempDir = await mkdtemp(join(process.cwd(), "temp_test_"));
    testFile = join(tempDir, "temp_test_file.txt");
    pngFile = join(tempDir, "temp_test_image.png");
    testRevertFile = join(tempDir, "temp_revert_file.txt");

    // Ensure we create a test file in the temp directory
    await writeFile(
      testFile,
      "hello world\nthis is a line\nhello world\nline 4\nhello world",
      "utf-8",
    );
  });

  afterAll(async () => {
    if (previousDisableWorktrees === undefined) {
      delete process.env.KNIGHTCODE_DISABLE_WORKTREES;
    } else {
      process.env.KNIGHTCODE_DISABLE_WORKTREES = previousDisableWorktrees;
    }

    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("editFile replaces single occurrence when replaceAll is false", async () => {
    // Setup file
    await writeFile(testFile, "apple bananana cherry", "utf-8");

    // Single replace
    const res = (await executeLocalTool(
      "editFile",
      {
        path: testFile,
        oldString: "bananana",
        newString: "banana",
        replaceAll: false,
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(res.success).toBe(true);
    expect(res.replacements).toBe(1);

    const content = await Bun.file(testFile).text();
    expect(content).toBe("apple banana cherry");
  });

  test("editFile throws error on multiple occurrences when replaceAll is false", async () => {
    await writeFile(testFile, "hello hello hello", "utf-8");

    expect(
      executeLocalTool(
        "editFile",
        {
          path: testFile,
          oldString: "hello",
          newString: "hi",
          replaceAll: false,
        },
        Mode.BUILD,
        "test-session",
      ),
    ).rejects.toThrow(/ambiguous/);
  });

  test("editFile replaces all occurrences when replaceAll is true", async () => {
    await writeFile(testFile, "hello hello hello", "utf-8");

    const res = (await executeLocalTool(
      "editFile",
      {
        path: testFile,
        oldString: "hello",
        newString: "hi",
        replaceAll: true,
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(res.success).toBe(true);
    expect(res.replacements).toBe(3);

    const content = await Bun.file(testFile).text();
    expect(content).toBe("hi hi hi");
  });

  test("grep supports caseInsensitive and different outputModes", async () => {
    await writeFile(testFile, "LINE ONE\nline two\nLINE THREE", "utf-8");

    // caseInsensitive matching
    const resContent = (await executeLocalTool(
      "grep",
      {
        pattern: "line",
        path: testFile,
        caseInsensitive: true,
        outputMode: "content",
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(resContent.results).toBeDefined();
    expect(resContent.results.length).toBe(3);

    // outputMode files
    const resFiles = (await executeLocalTool(
      "grep",
      {
        pattern: "LINE ONE",
        path: testFile,
        outputMode: "files",
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(resFiles.results).toBeDefined();
    expect(resFiles.results.length).toBe(1);
    expect(resFiles.results[0].file).toContain(
      relative(process.cwd(), testFile),
    );

    // outputMode count
    const resCount = (await executeLocalTool(
      "grep",
      {
        pattern: "LINE",
        path: testFile,
        outputMode: "count",
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(resCount.results).toBeDefined();
    expect(resCount.results.length).toBe(1);
    expect(resCount.results[0].count).toBe(2);
  });

  test("readFile supports pagination offset and limit", async () => {
    await writeFile(testFile, "line1\nline2\nline3\nline4\nline5", "utf-8");

    const res = (await executeLocalTool(
      "readFile",
      {
        path: testFile,
        offset: 1,
        limit: 3,
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(res.content).toBe("line2\nline3\nline4");
    expect(res.totalLines).toBe(5);
    expect(res.offset).toBe(1);
    expect(res.linesReturned).toBe(3);
    expect(res.truncated).toBe(true);
  });

  test("readFile supports image files by encoding to base64", async () => {
    const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // png magic bytes
    await writeFile(pngFile, data);

    try {
      const res = (await executeLocalTool(
        "readFile",
        {
          path: pngFile,
        },
        Mode.BUILD,
        "test-session",
      )) as any;

      expect(res.isImage).toBe(true);
      expect(res.mimeType).toBe("image/png");
      expect(res.content).toBe(data.toString("base64"));
      expect(res.totalLength).toBe(data.length);
    } finally {
      try {
        await unlink(pngFile);
      } catch {}
    }
  });

  test("undoSessionChanges reverts file changes successfully", async () => {
    await writeFile(testRevertFile, "initial content", "utf-8");

    try {
      // Modify file via editFile
      await executeLocalTool(
        "editFile",
        {
          path: testRevertFile,
          oldString: "initial content",
          newString: "modified content",
          replaceAll: false,
        },
        Mode.BUILD,
        "test-session",
      );

      // Verify it was modified
      const current = await Bun.file(testRevertFile).text();
      expect(current).toBe("modified content");

      // Undo changes
      const undoRes = await undoSessionChanges("test-session");
      expect(undoRes.revertedFiles).toContain(
        relative(process.cwd(), testRevertFile),
      );

      // Verify it was reverted to initial content
      const reverted = await Bun.file(testRevertFile).text();
      expect(reverted).toBe("initial content");
    } finally {
      try {
        await unlink(testRevertFile);
      } catch {}
    }
  });

  test("gitStatus, gitDiff, and gitLog execute without throwing", async () => {
    // These might return exitCode non-zero or error if git is not initialized in CWD,
    // but the execution of the tool itself should not crash.
    const resStatus = (await executeLocalTool(
      "gitStatus",
      {},
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(resStatus.exitCode).toBeDefined();

    const resDiff = (await executeLocalTool(
      "gitDiff",
      {},
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(resDiff.exitCode).toBeDefined();

    const resLog = (await executeLocalTool(
      "gitLog",
      { limit: 5 },
      Mode.BUILD,
      "test-session",
    )) as any;
    expect(resLog.exitCode).toBeDefined();
  });

  test("bash runs a command in the background and registers it", async () => {
    const res = (await executeLocalTool(
      "bash",
      {
        command: "sleep 10",
        runInBackground: true,
      },
      Mode.BUILD,
      "test-session",
    )) as any;

    expect(res.success).toBe(true);
    expect(res.pid).toBeDefined();
    expect(res.message).toContain("background");

    // Clean up the spawned sleeping process
    try {
      process.kill(res.pid, "SIGKILL");
    } catch {}
  });
});

describe("local-tools worktree isolation", () => {
  test("writes happen in a session worktree without changing the main checkout", async () => {
    const previousCwd = process.cwd();
    const previousDisableWorktrees = process.env.KNIGHTCODE_DISABLE_WORKTREES;
    delete process.env.KNIGHTCODE_DISABLE_WORKTREES;

    const repoDir = await mkdtemp(join(tmpdir(), "knightcode-wt-"));

    try {
      const git = (args: string[]) =>
        spawnSync("git", args, {
          cwd: repoDir,
          encoding: "utf-8",
          windowsHide: true,
        });

      expect(git(["init"]).status).toBe(0);
      await writeFile(join(repoDir, "file.txt"), "main", "utf-8");
      expect(git(["add", "file.txt"]).status).toBe(0);
      expect(
        git([
          "-c",
          "user.email=test@example.com",
          "-c",
          "user.name=Test User",
          "commit",
          "-m",
          "init",
        ]).status,
      ).toBe(0);

      process.chdir(repoDir);

      // Enable worktree isolation explicitly since the default is now direct mode
      setWorktreeDisabled(repoDir, false);

      const result = (await executeLocalTool(
        "writeFile",
        { path: "file.txt", content: "worktree" },
        Mode.BUILD,
        "session-worktree-test",
      )) as any;

      expect(result.success).toBe(true);
      expect(readFileSync(join(repoDir, "file.txt"), "utf-8")).toBe("main");

      const record = getWorktreeStatus("session-worktree-test", repoDir);
      expect(record).not.toBeNull();
      expect(record?.worktreePath).toBeTruthy();
      expect(existsSync(join(record!.worktreePath, "file.txt"))).toBe(true);
      expect(
        readFileSync(join(record!.worktreePath, "file.txt"), "utf-8"),
      ).toBe("worktree");
    } finally {
      process.chdir(previousCwd);
      if (previousDisableWorktrees === undefined) {
        delete process.env.KNIGHTCODE_DISABLE_WORKTREES;
      } else {
        process.env.KNIGHTCODE_DISABLE_WORKTREES = previousDisableWorktrees;
      }
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("can toggle worktree isolation and write directly to repo when disabled", async () => {
    const previousCwd = process.cwd();
    const repoDir = await mkdtemp(join(tmpdir(), "knightcode-wt-toggle-"));

    try {
      const git = (args: string[]) =>
        spawnSync("git", args, {
          cwd: repoDir,
          encoding: "utf-8",
          windowsHide: true,
        });

      expect(git(["init"]).status).toBe(0);
      await writeFile(join(repoDir, "file.txt"), "main", "utf-8");
      expect(git(["add", "file.txt"]).status).toBe(0);
      expect(
        git([
          "-c",
          "user.email=test@example.com",
          "-c",
          "user.name=Test User",
          "commit",
          "-m",
          "init",
        ]).status,
      ).toBe(0);

      process.chdir(repoDir);

      // Disable worktrees via the function
      setWorktreeDisabled(repoDir, true);
      expect(isWorktreeDisabled(repoDir)).toBe(true);

      const result = (await executeLocalTool(
        "writeFile",
        { path: "file.txt", content: "direct" },
        Mode.BUILD,
        "session-toggle-test",
      )) as any;

      expect(result.success).toBe(true);
      // Since it's direct mode, the parent file should be changed to "direct"!
      expect(readFileSync(join(repoDir, "file.txt"), "utf-8")).toBe("direct");
    } finally {
      process.chdir(previousCwd);
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
