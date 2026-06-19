import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execute } from "./execute";
import { getLedgerEntry, clearFileLedger } from "../shared/file-ledger";

const session = "read-ledger-test";

describe("Read records into the file ledger", () => {
  afterEach(() => clearFileLedger(session));

  it("records the file's mtime after a successful read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "readled-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, "hello", "utf-8");
    try {
      await execute({ file_path: file }, { executionRoot: dir, sessionId: session });
      expect(typeof getLedgerEntry(session, resolve(dir, file))).toBe("number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT record when the read itself fails (a directory → EISDIR)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "readled-"));
    const subdir = join(dir, "adir");
    mkdirSync(subdir); // stat() succeeds, but reading it as a file fails
    try {
      await expect(
        execute({ file_path: subdir }, { executionRoot: dir, sessionId: session }),
      ).rejects.toBeDefined();
      expect(getLedgerEntry(session, resolve(dir, subdir))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
