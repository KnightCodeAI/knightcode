import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
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
});
