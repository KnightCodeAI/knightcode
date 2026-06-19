import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execute as editExecute } from "../Edit/execute";
import { execute as writeExecute } from "../Write/execute";
import { execute as readExecute } from "../Read/execute";
import { clearFileLedger } from "./file-ledger";

const session = "write-guard-test";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "wguard-"));
  return { dir, file: join(dir, "f.txt") };
}

describe("edit tools enforce read-before-write", () => {
  afterEach(() => clearFileLedger(session));

  it("Edit rejects a file that was never read", async () => {
    const { dir, file } = setup();
    writeFileSync(file, "apple cherry", "utf-8");
    try {
      await expect(
        editExecute(
          { file_path: file, old_string: "apple", new_string: "A", replace_all: false },
          { executionRoot: dir, sessionId: session },
        ),
      ).rejects.toThrow(/has not been read/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Edit succeeds after a read", async () => {
    const { dir, file } = setup();
    writeFileSync(file, "apple cherry", "utf-8");
    try {
      await readExecute({ file_path: file }, { executionRoot: dir, sessionId: session });
      const res = (await editExecute(
        { file_path: file, old_string: "apple", new_string: "A", replace_all: false },
        { executionRoot: dir, sessionId: session },
      )) as { success: boolean };
      expect(res.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Edit rejects when the file changed on disk after the read", async () => {
    const { dir, file } = setup();
    writeFileSync(file, "apple cherry", "utf-8");
    try {
      await readExecute({ file_path: file }, { executionRoot: dir, sessionId: session });
      const future = new Date(Date.now() + 5000);
      utimesSync(file, future, future); // external modification
      await expect(
        editExecute(
          { file_path: file, old_string: "apple", new_string: "A", replace_all: false },
          { executionRoot: dir, sessionId: session },
        ),
      ).rejects.toThrow(/modified since/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Write CREATES a new file without a prior read", async () => {
    const { dir, file } = setup(); // file does not exist yet
    try {
      const res = (await writeExecute(
        { file_path: file, content: "fresh" },
        { executionRoot: dir, sessionId: session },
      )) as { success: boolean };
      expect(res.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Write REJECTS overwriting an existing unread file", async () => {
    const { dir, file } = setup();
    writeFileSync(file, "existing", "utf-8");
    try {
      await expect(
        writeExecute(
          { file_path: file, content: "clobber" },
          { executionRoot: dir, sessionId: session },
        ),
      ).rejects.toThrow(/has not been read/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Edit on a file deleted after the read is rejected with a clear message", async () => {
    const { dir, file } = setup();
    writeFileSync(file, "apple cherry", "utf-8");
    try {
      await readExecute({ file_path: file }, { executionRoot: dir, sessionId: session });
      rmSync(file, { force: true }); // deleted after the read
      await expect(
        editExecute(
          { file_path: file, old_string: "apple", new_string: "A", replace_all: false },
          { executionRoot: dir, sessionId: session },
        ),
      ).rejects.toThrow(/deleted since/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two Edits in a row succeed (recordWrite refreshes the ledger)", async () => {
    const { dir, file } = setup();
    writeFileSync(file, "apple cherry", "utf-8");
    try {
      await readExecute({ file_path: file }, { executionRoot: dir, sessionId: session });
      await editExecute(
        { file_path: file, old_string: "apple", new_string: "A", replace_all: false },
        { executionRoot: dir, sessionId: session },
      );
      const res = (await editExecute(
        { file_path: file, old_string: "cherry", new_string: "C", replace_all: false },
        { executionRoot: dir, sessionId: session },
      )) as { success: boolean };
      expect(res.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
