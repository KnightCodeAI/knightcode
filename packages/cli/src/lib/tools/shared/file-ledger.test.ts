import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  recordRead,
  recordWrite,
  assertWritable,
  clearFileLedger,
  getLedgerEntry,
  seedFileLedgerFromTranscript,
} from "./file-ledger";

describe("file-ledger", () => {
  let dir: string;
  let file: string;
  const session = "ledger-test";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ledger-"));
    file = join(dir, "f.txt");
    writeFileSync(file, "one", "utf-8");
    clearFileLedger(session);
  });
  afterEach(() => {
    clearFileLedger(session);
    rmSync(dir, { recursive: true, force: true });
  });

  it("recordRead stores the file's mtime", () => {
    expect(getLedgerEntry(session, file)).toBeUndefined();
    recordRead(session, file);
    expect(typeof getLedgerEntry(session, file)).toBe("number");
  });

  it("assertWritable throws when the file was never read", () => {
    expect(() => assertWritable(session, file)).toThrow(/has not been read/i);
  });

  it("assertWritable passes after a read", () => {
    recordRead(session, file);
    expect(() => assertWritable(session, file)).not.toThrow();
  });

  it("assertWritable throws when the file changed on disk since the read", () => {
    recordRead(session, file);
    // Bump mtime 5s into the future to defeat coarse-granularity filesystems.
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    expect(() => assertWritable(session, file)).toThrow(/modified since/i);
  });

  it("recordWrite refreshes the mtime so a follow-up edit doesn't trip", () => {
    recordRead(session, file);
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    expect(() => assertWritable(session, file)).toThrow(/modified since/i);
    recordWrite(session, file); // we just wrote it — re-record
    expect(() => assertWritable(session, file)).not.toThrow();
  });

  it("allowCreate lets a brand-new (nonexistent) file through without a read", () => {
    const missing = join(dir, "new.txt");
    expect(() => assertWritable(session, missing, { allowCreate: true })).not.toThrow();
    // But an EXISTING unread file is still rejected even with allowCreate.
    expect(() => assertWritable(session, file, { allowCreate: true })).toThrow(
      /has not been read/i,
    );
  });

  it("an edit (no allowCreate) on a file deleted after the read is rejected, not bypassed", () => {
    recordRead(session, file);
    rmSync(file, { force: true }); // deleted after the read
    expect(() => assertWritable(session, file)).toThrow(/deleted since/i);
  });

  it("Write (allowCreate) may recreate a file deleted after the read", () => {
    recordRead(session, file);
    rmSync(file, { force: true });
    expect(() =>
      assertWritable(session, file, { allowCreate: true }),
    ).not.toThrow();
  });

  it("clearFileLedger drops the session's state", () => {
    recordRead(session, file);
    clearFileLedger(session);
    expect(getLedgerEntry(session, file)).toBeUndefined();
  });

  it("seeds the ledger from Read tool calls in a transcript", () => {
    const rel = "f.txt"; // relative to `dir` (the execution root)
    const transcript = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-Read",
            toolCallId: "t1",
            state: "output-available",
            input: { file_path: rel },
            output: { content: "one" },
          },
        ],
      },
    ];
    expect(getLedgerEntry(session, file)).toBeUndefined();
    seedFileLedgerFromTranscript(session, transcript as never, dir);
    expect(typeof getLedgerEntry(session, file)).toBe("number");
  });

  it("seeding ignores non-Read parts and missing files", () => {
    const transcript = [
      {
        role: "assistant",
        parts: [
          { type: "text", text: "hello" },
          {
            type: "tool-Read",
            toolCallId: "t2",
            state: "output-available",
            input: { file_path: "does-not-exist.txt" },
          },
        ],
      },
    ];
    seedFileLedgerFromTranscript(session, transcript as never, dir);
    expect(getLedgerEntry(session, join(dir, "does-not-exist.txt"))).toBeUndefined();
  });
});
