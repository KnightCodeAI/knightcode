# Phase D (Slice 1) — Harness Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two reported correctness bugs (editing a file before reading it / clobbering external changes, and the same tool firing 2+ times) and add transient stream-error recovery — without yet touching in-loop compaction.

**Architecture:** Four additive mechanisms on the existing engine. (1) A session-scoped **file-state ledger** (`lib/tools/shared/file-ledger.ts`) mirroring the existing undo ledger (`session-snapshot.ts`): the `Read` tool records each file's mtime; `Edit`/`MultiEdit`/`Write`/`NotebookEdit` refuse to write a file that was never read or was modified since the read, then refresh the record after writing. The engine seeds the ledger from the transcript at turn start so it survives a resume. (2) A **stricter loop guard** — `LOOP_LIMIT` 8→3. (3) **Within-round dedup** of identical concurrency-safe calls in the scheduler. (4) A **recovery primitive** (`lib/engine/recovery.ts`) and a retry loop around the per-round model stream in `query.ts`, emitting a new `retry` EngineEvent.

**Tech Stack:** TypeScript, Bun test runner (`bun test`), `tsc --noEmit` via `bun run check-types`, AI SDK (`streamText` + `MockLanguageModelV3` test seam).

## Global Constraints

- Runtime is **Bun**; `cd packages/cli && bun test` (discovery) and `cd packages/cli && bun run check-types` must both stay green after every task.
- **No new dependencies** — everything here is stdlib (`fs`) + existing engine code.
- The file ledger is a **module-level `Map<sessionId, Map<resolvedPath, mtimeMs>>`**, mirroring `lib/tools/shared/session-snapshot.ts` exactly (same keying, same lifetime). It is **not** threaded through the scheduler.
- A tool's `execute` throwing is already converted to a uniform `{ kind: "error", errorText }` tool result by `scheduler.ts:223-231`. So a per-tool `throw` for a ledger violation yields the same uniform `output-error` pairing the harness doc wanted from a central check — the per-tool placement is deliberate and matches the existing `recordOriginalContent` pattern in every edit tool.
- Context/recovery code **must never** corrupt tool_use/tool_result pairing. The retry loop only retries when **no assistant content was emitted this round** (transient establishment/empty-response failures); once text/reasoning/tool-call parts exist, errors are terminal as today.
- New-file headers, comment density, and naming must match the surrounding code (`session-snapshot.ts` is the template for the ledger; `context-providers.ts`/`recall.ts` for engine-side style).

### Deliberate scope cuts (Slice 1)

- **In-loop compaction is NOT in this slice** (deferred to Phase D Slice 2, per `docs/knightcode-upgrade-plan-2026-06-16.md` "Suggested sequencing" rows #2 vs #5).
- **Bash read-path recording is deferred.** `lib/tools/Bash/execute.ts` receives only `ctx: { executionRoot }` (no `sessionId`), and attributing reads by parsing arbitrary shell is fragile/low-value. Recording `Read` + checking at edit time fully fixes the reported bugs (`harness-followup-2026-06-16.md` §3 lists Bash as "ideally"). Documented follow-up.
- The streaming retry site uses the recovery **primitives** (`isRetryableError`/`getRetryAfterMs`/`backoffDelayMs`/`sleep`) directly rather than the generic `withRetry` wrapper, because the round yields UI events as it streams and a plain `await withRetry(fn)` cannot delegate `yield`. `withRetry` is still shipped + tested as the reusable primitive (and the natural fit for the Phase E subagent path).

---

### Task 1: File-state ledger module

**Files:**
- Create: `packages/cli/src/lib/tools/shared/file-ledger.ts`
- Test: `packages/cli/src/lib/tools/shared/file-ledger.test.ts`

**Why:** The single source of "has this file been read this session, and at what mtime". Mirrors `session-snapshot.ts` (module-level map keyed by `sessionId`) so it survives across turns within a process and is shared between the `Read` tool (records) and the edit tools (check + refresh).

**Interfaces:**
- Produces:
  - `recordRead(sessionId: string, resolvedPath: string): void` — store the file's current mtime; no-op if it can't be stat'd.
  - `recordWrite(sessionId: string, resolvedPath: string): void` — refresh the stored mtime after a successful write (alias of `recordRead`).
  - `assertWritable(sessionId: string, resolvedPath: string, opts?: { allowCreate?: boolean }): void` — throw if the file was never read (unless `allowCreate` and it doesn't exist) or was modified on disk since the recorded read.
  - `clearFileLedger(sessionId: string): void` — drop a session's read-state.
  - `getLedgerEntry(sessionId: string, resolvedPath: string): number | undefined` — recorded mtime or `undefined` (seed/test helper).

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/tools/shared/file-ledger.test.ts`:

```typescript
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

  it("clearFileLedger drops the session's state", () => {
    recordRead(session, file);
    clearFileLedger(session);
    expect(getLedgerEntry(session, file)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/lib/tools/shared/file-ledger.test.ts`
Expected: FAIL — `./file-ledger` does not exist (module not found).

- [ ] **Step 3: Implement the ledger**

Create `packages/cli/src/lib/tools/shared/file-ledger.ts`:

```typescript
import { statSync } from "fs";

/**
 * Session-scoped read-state ledger: per session, the resolved absolute path of
 * every file the model has read this session → that file's mtimeMs at read
 * time. Mirrors session-snapshot.ts (the undo ledger) — a module-level map keyed
 * by sessionId, so it survives across turns within a process and is shared
 * between the Read tool (records reads) and the edit tools (check before write,
 * refresh after). The engine seeds it from the transcript at turn start
 * (seedFileLedgerFromTranscript) so it survives a resume across restart.
 */
const sessionReadState = new Map<string, Map<string, number>>();

function ledgerFor(sessionId: string): Map<string, number> {
  let m = sessionReadState.get(sessionId);
  if (!m) {
    m = new Map();
    sessionReadState.set(sessionId, m);
  }
  return m;
}

/** Record that `resolvedPath` was just read; stores its current mtime. No-op if
 *  the file can't be stat'd (vanished between read and record). */
export function recordRead(sessionId: string, resolvedPath: string): void {
  try {
    ledgerFor(sessionId).set(resolvedPath, statSync(resolvedPath).mtimeMs);
  } catch {
    // nothing to record
  }
}

/** Record a successful write — refresh the stored mtime so back-to-back edits
 *  on the same file don't trip the staleness check. */
export function recordWrite(sessionId: string, resolvedPath: string): void {
  recordRead(sessionId, resolvedPath);
}

/**
 * Throw if `resolvedPath` may not be safely written:
 * - never read this session → "read it first" (unless `allowCreate` and the file
 *   does not yet exist — a genuine create);
 * - newer on disk than the recorded read → "modified since read".
 * Call before an edit/write executes; call recordWrite after it succeeds.
 */
export function assertWritable(
  sessionId: string,
  resolvedPath: string,
  opts: { allowCreate?: boolean } = {},
): void {
  const recorded = ledgerFor(sessionId).get(resolvedPath);

  let exists = true;
  let currentMtime = 0;
  try {
    currentMtime = statSync(resolvedPath).mtimeMs;
  } catch {
    exists = false;
  }

  if (recorded === undefined) {
    if (opts.allowCreate && !exists) return; // creating a brand-new file
    throw new Error(
      `File has not been read yet. Read ${resolvedPath} first before writing to it.`,
    );
  }
  // Strict `>`: an unchanged file (equal mtime) is fine; only a later mtime is
  // a real external/foreign modification.
  if (exists && currentMtime > recorded) {
    throw new Error(
      `File has been modified since you last read it (by you, the user, or a tool). Read ${resolvedPath} again before writing to it.`,
    );
  }
}

/** Drop a session's read-state (session end). */
export function clearFileLedger(sessionId: string): void {
  sessionReadState.delete(sessionId);
}

/** Current recorded mtime for a path, or undefined. (Seed/test helper.) */
export function getLedgerEntry(
  sessionId: string,
  resolvedPath: string,
): number | undefined {
  return sessionReadState.get(sessionId)?.get(resolvedPath);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/tools/shared/file-ledger.test.ts`
Expected: PASS (all seven).

- [ ] **Step 5: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/tools/shared/file-ledger.ts packages/cli/src/lib/tools/shared/file-ledger.test.ts
git commit -m "feat(engine): session-scoped file-state ledger"
```

---

### Task 2: Record reads in the Read tool

**Files:**
- Modify: `packages/cli/src/lib/tools/Read/execute.ts`
- Test: `packages/cli/src/lib/tools/Read/read-ledger.test.ts` (new)

**Why:** Every successful `Read` must record the file's mtime so the edit tools (Task 3) can tell "this was read" from "the model guessed". `Read` already receives `ctx: { executionRoot }`; it needs `sessionId` too (every other ledger-aware tool already gets it).

**Interfaces:**
- Consumes: `recordRead` (Task 1), `resolveInsideRoot` (already imported).
- Produces: `execute(input, ctx: { executionRoot: string; sessionId: string })` — same return shape; side effect: records the read. (`tools/index.ts` already passes `sessionId` in the ctx for every tool — no dispatcher change needed.)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/tools/Read/read-ledger.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/lib/tools/Read/read-ledger.test.ts`
Expected: FAIL — `execute` doesn't accept/record `sessionId`; `getLedgerEntry` returns `undefined`.

- [ ] **Step 3: Record on success**

In `packages/cli/src/lib/tools/Read/execute.ts`, add the import after the existing `path-resolution` import (line 8):

```typescript
import { recordRead } from "../shared/file-ledger";
```

Change the `execute` signature (line 15-18) to take `sessionId`:

```typescript
export async function execute(
  input: unknown,
  ctx: { executionRoot: string; sessionId: string },
): Promise<unknown> {
```

Record the read right after the path is validated, just below `assertSafeProjectFile(resolved, cwd, "read");` (currently line 21):

```typescript
  assertSafeProjectFile(resolved, cwd, "read");
  recordRead(ctx.sessionId, resolved);
```

(Recording here — after the path is proven safe and in-root, before the actual byte read — is correct: a subsequent read failure is rare, and recording the mtime of a file we're about to read is the intended semantics. Image reads, ranged reads, and oversized reads all flow through this same point.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/tools/Read/read-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing Read suite + type-check**

Run: `cd packages/cli && bun test src/lib/tools/tools.test.ts && bun run check-types`
Expected: PASS / clean. (`tools.test.ts` "Read returns file contents" already passes `"test-session"` as the sessionId through `executeLocalTool`, so the new ctx field is already supplied.)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/tools/Read/execute.ts packages/cli/src/lib/tools/Read/read-ledger.test.ts
git commit -m "feat(tools): Read records file mtime into the ledger"
```

---

### Task 3: Read-before-write + staleness guard in the edit tools

**Files:**
- Modify: `packages/cli/src/lib/tools/Edit/execute.ts`
- Modify: `packages/cli/src/lib/tools/MultiEdit/execute.ts`
- Modify: `packages/cli/src/lib/tools/Write/execute.ts`
- Modify: `packages/cli/src/lib/tools/NotebookEdit/execute.ts`
- Test: `packages/cli/src/lib/tools/shared/write-guard.test.ts` (new)
- Modify (fix breakage): `packages/cli/src/lib/tools/tools.test.ts`

**Why:** This is the actual fix for "edited a file before reading it / clobbered external changes" (`harness-followup-2026-06-16.md` §3). Each edit tool gains a real precondition: `assertWritable` before it reads/writes, `recordWrite` after a successful write. `Write` passes `allowCreate: true` (you can't read a file you're creating); `Edit`/`MultiEdit`/`NotebookEdit` require a prior read. The Edit/MultiEdit/NotebookEdit prompts already *claim* this is enforced (`shared/.../Edit/index.ts:32` etc.) — this makes the claim true.

**Interfaces:**
- Consumes: `assertWritable`, `recordWrite` (Task 1). All four tools already receive `ctx: { executionRoot, sessionId }` and already compute `resolved`.
- Produces: no signature changes; behavior change only (a guarded write).

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/lib/tools/shared/write-guard.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/tools/shared/write-guard.test.ts`
Expected: FAIL — no guard yet, so "never read" and "modified since" edits succeed instead of throwing, and the second back-to-back edit might pass for the wrong reason.

- [ ] **Step 3: Add the guard to `Edit`**

In `packages/cli/src/lib/tools/Edit/execute.ts`, add the import after the `session-snapshot` import (line 14):

```typescript
import { assertWritable, recordWrite } from "../shared/file-ledger";
```

Add the precondition immediately after `assertSafeProjectFile(resolved, cwd, "modify");` (line 25), before `recordOriginalContent`:

```typescript
  assertSafeProjectFile(resolved, cwd, "modify");
  assertWritable(ctx.sessionId, resolved);
```

Refresh the ledger after the write. There are two `writeFile` exits in this file — the empty-`old_string` create branch and the normal branch. Update both. For the empty branch (currently line 35-40):

```typescript
    await writeFile(resolved, new_string, "utf-8");
    recordWrite(ctx.sessionId, resolved);
    return {
      success: true as const,
      path: relative(cwd, resolved),
      replacements: 1,
    };
```

For the normal branch (currently line 79-84):

```typescript
  await writeFile(resolved, updated, "utf-8");
  recordWrite(ctx.sessionId, resolved);
  return {
    success: true as const,
    path: relative(cwd, resolved),
    replacements: replace_all ? occurrences : 1,
  };
```

- [ ] **Step 4: Add the guard to `MultiEdit`**

In `packages/cli/src/lib/tools/MultiEdit/execute.ts`, add the import after the `session-snapshot` import (line 14):

```typescript
import { assertWritable, recordWrite } from "../shared/file-ledger";
```

Add the precondition after `assertSafeProjectFile(resolved, cwd, "modify");` (line 28):

```typescript
  assertSafeProjectFile(resolved, cwd, "modify");
  assertWritable(ctx.sessionId, resolved);
```

Refresh after the single `writeFile` (currently line 95):

```typescript
  await writeFile(resolved, working, "utf-8");
  recordWrite(ctx.sessionId, resolved);
  return {
```

- [ ] **Step 5: Add the guard to `Write` (with `allowCreate`)**

In `packages/cli/src/lib/tools/Write/execute.ts`, add the import after the `session-snapshot` import (line 9):

```typescript
import { assertWritable, recordWrite } from "../shared/file-ledger";
```

Add the precondition after `assertSafeProjectFile(resolved, cwd, "modify");` (line 19), before the `mkdir`:

```typescript
  assertSafeProjectFile(resolved, cwd, "modify");
  assertWritable(ctx.sessionId, resolved, { allowCreate: true });
```

Refresh after the `writeFile` (currently line 35):

```typescript
  await writeFile(resolved, contentToWrite, "utf-8");
  recordWrite(ctx.sessionId, resolved);
  return {
```

- [ ] **Step 6: Add the guard to `NotebookEdit`**

In `packages/cli/src/lib/tools/NotebookEdit/execute.ts`, add the import after the `session-snapshot` import (line 8):

```typescript
import { assertWritable, recordWrite } from "../shared/file-ledger";
```

Add the precondition after `assertSafeProjectFile(resolved, cwd, "modify");` (line 67), before the `.ipynb` extension check:

```typescript
  assertSafeProjectFile(resolved, cwd, "modify");
  assertWritable(ctx.sessionId, resolved);
```

Refresh after the `writeFile` (currently line 130):

```typescript
  await writeFile(resolved, updated, "utf-8");
  recordWrite(ctx.sessionId, resolved);
  return {
```

- [ ] **Step 7: Fix the now-failing `tools.test.ts` edit tests**

The existing dispatcher tests `writeFile` a fixture then edit it **without reading first** — the guard now (correctly) rejects them. Insert a `Read` after each `writeFile` so each edit flow reads before writing (this also refreshes the ledger mtime to the just-written file, so the staleness check passes). In `packages/cli/src/lib/tools/tools.test.ts`:

In "Edit replaces single occurrence" (after line 35 `await writeFile(testFile, "apple bananana cherry", "utf-8");`), add:

```typescript
    await executeLocalTool("Read", { file_path: testFile }, Mode.BUILD, "test-session");
```

In "Edit rejects ambiguous match without replace_all" (after line 52 `await writeFile(testFile, "hello hello hello", "utf-8");`), add:

```typescript
    await executeLocalTool("Read", { file_path: testFile }, Mode.BUILD, "test-session");
```

In "MultiEdit applies edits sequentially and atomically" (after line 69 `await writeFile(testFile, "alpha bravo charlie", "utf-8");`), add:

```typescript
    await executeLocalTool("Read", { file_path: testFile }, Mode.BUILD, "test-session");
```

In "MultiEdit rolls back when a later edit fails" (after line 89 `await writeFile(testFile, "alpha bravo charlie", "utf-8");`), add:

```typescript
    await executeLocalTool("Read", { file_path: testFile }, Mode.BUILD, "test-session");
```

("PLAN mode blocks Write" needs no change — the mode check in `executeRegisteredTool` rejects before the executor/guard runs.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/tools/shared/write-guard.test.ts src/lib/tools/tools.test.ts`
Expected: PASS (new guard tests + the patched dispatcher tests).

- [ ] **Step 9: Type-check + full suite**

Run: `cd packages/cli && bun run check-types && bun test`
Expected: clean / all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/lib/tools/Edit/execute.ts packages/cli/src/lib/tools/MultiEdit/execute.ts packages/cli/src/lib/tools/Write/execute.ts packages/cli/src/lib/tools/NotebookEdit/execute.ts packages/cli/src/lib/tools/shared/write-guard.test.ts packages/cli/src/lib/tools/tools.test.ts
git commit -m "feat(tools): enforce read-before-write + staleness guard on edits"
```

---

### Task 4: Seed the ledger from the transcript at turn start

**Files:**
- Modify: `packages/cli/src/lib/tools/shared/file-ledger.ts`
- Modify: `packages/cli/src/lib/engine/query.ts`
- Test: `packages/cli/src/lib/tools/shared/file-ledger.test.ts` (extend)

**Why:** The module-level ledger is empty after a process restart. knightcode sessions persist and resume, so without seeding, the first edit after a resume would wrongly demand a re-read of a file the model already read earlier in the session. claude-code seeds `readFileState` from the transcript for exactly this reason (`harness-followup-2026-06-16.md` §3, "Seeded from the transcript on resume"). We scan the transcript for resolved `Read` tool calls and record each existing file at its current mtime.

**Interfaces:**
- Consumes: `recordRead` (Task 1), `resolveInsideRoot` (`../path-resolution`), the engine `Message` type.
- Produces: `seedFileLedgerFromTranscript(sessionId: string, messages: { parts?: unknown[] }[], cwd: string): void` — best-effort; never throws.
- Wired in `query.ts` once before the round loop, only when `params.sessionId` is set.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/src/lib/tools/shared/file-ledger.test.ts` (and add `seedFileLedgerFromTranscript` to the import at the top):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/lib/tools/shared/file-ledger.test.ts`
Expected: FAIL — `seedFileLedgerFromTranscript` is not exported.

- [ ] **Step 3: Implement seeding**

In `packages/cli/src/lib/tools/shared/file-ledger.ts`, add the import at the top:

```typescript
import { resolveInsideRoot } from "./path-resolution";
```

Append at the end of the file:

```typescript
/**
 * Seed the ledger from a transcript: every successful `Read` tool call becomes a
 * recorded read at the file's CURRENT mtime. Lets the guard survive a resume so
 * the model isn't forced to re-read files it already read this session. Records
 * current mtime (the transcript has no stored mtime); an external edit made
 * while the process was down is therefore not detected — acceptable, the same
 * limitation claude-code accepts. Best-effort: never throws.
 */
export function seedFileLedgerFromTranscript(
  sessionId: string,
  messages: { parts?: unknown[] }[],
  cwd: string,
): void {
  for (const message of messages ?? []) {
    for (const part of message?.parts ?? []) {
      const p = part as {
        type?: string;
        state?: string;
        input?: { file_path?: unknown };
      };
      if (p?.type !== "tool-Read" || p?.state !== "output-available") continue;
      const filePath = p.input?.file_path;
      if (typeof filePath !== "string" || !filePath) continue;
      try {
        const { resolved } = resolveInsideRoot(cwd, filePath);
        recordRead(sessionId, resolved); // no-op if the file no longer exists
      } catch {
        // path outside root / unresolvable — skip
      }
    }
  }
}
```

- [ ] **Step 4: Wire it into `query.ts`**

In `packages/cli/src/lib/engine/query.ts`, add the import next to the other tool/engine imports (after line 29's `transcript` import):

```typescript
import { seedFileLedgerFromTranscript } from "../tools/shared/file-ledger";
```

Seed once, right after the transcript is built (currently line 97-98, after `extractLoadedDeferredTools`):

```typescript
  const transcript = repairTranscript(params.messages);
  const loadedDeferred = extractLoadedDeferredTools(transcript);
  // Seed the file-read ledger from prior Read calls so the read-before-write
  // guard survives a resume (the in-memory ledger is empty after a restart).
  if (params.sessionId) {
    seedFileLedgerFromTranscript(params.sessionId, transcript, cwd);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/tools/shared/file-ledger.test.ts src/lib/engine/query.test.ts`
Expected: PASS (seeding tests + the existing query suite, which passes no `sessionId` so seeding is skipped).

- [ ] **Step 6: Type-check + commit**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

```bash
git add packages/cli/src/lib/tools/shared/file-ledger.ts packages/cli/src/lib/tools/shared/file-ledger.test.ts packages/cli/src/lib/engine/query.ts
git commit -m "feat(engine): seed file-read ledger from transcript on resume"
```

---

### Task 5: Tighten the loop guard (8 → 3)

**Files:**
- Modify: `packages/cli/src/lib/engine/tool-runner.ts` (`LOOP_LIMIT`, line 46)
- Modify: `packages/cli/src/lib/engine/tool-runner.test.ts` (the `ToolLoopGuard` describe block, lines 62-81)

**Why:** `LOOP_LIMIT = 8` lets 2-7 identical calls through, which is exactly the "same tool called 2+ times" the user reported. 2-3 identical calls already signal a stuck model (`harness-followup-2026-06-16.md` §4.1). Lower to 3; keep the corrective `LOOP_PROTECTION_ERROR` and the `TodoWrite` exemption.

**Interfaces:** no API change — `ToolLoopGuard.check` keeps its signature; only the threshold constant changes.

- [ ] **Step 1: Update the test to the new threshold**

In `packages/cli/src/lib/engine/tool-runner.test.ts`, replace the `ToolLoopGuard` describe block (lines 62-81) with:

```typescript
describe("ToolLoopGuard", () => {
  test("rejects the 4th identical call; TodoWrite exempt", () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 3; i++) {
      expect(guard.check("Grep", { pattern: "x" })).toBe(true);
    }
    expect(guard.check("Grep", { pattern: "x" })).toBe(false);
    expect(guard.check("Grep", { pattern: "y" })).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(guard.check("TodoWrite", { todos: [] })).toBe(true);
    }
  });

  test("reset clears counts", () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 4; i++) guard.check("Grep", { pattern: "x" });
    guard.reset();
    expect(guard.check("Grep", { pattern: "x" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/cli && bun test src/lib/engine/tool-runner.test.ts`
Expected: FAIL — with `LOOP_LIMIT = 8`, the 4th identical call still returns `true`.

- [ ] **Step 3: Lower the constant**

In `packages/cli/src/lib/engine/tool-runner.ts`, change line 46:

```typescript
const LOOP_LIMIT = 3;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/engine/tool-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

```bash
git add packages/cli/src/lib/engine/tool-runner.ts packages/cli/src/lib/engine/tool-runner.test.ts
git commit -m "fix(engine): lower loop-guard threshold from 8 to 3"
```

---

### Task 6: Dedup identical concurrency-safe calls within a round

**Files:**
- Modify: `packages/cli/src/lib/engine/scheduler.ts` (the safe-batch branch, lines 247-272)
- Test: `packages/cli/src/lib/engine/scheduler.test.ts`

**Why:** When the model emits two identical safe calls in one round, the scheduler runs both (`harness-followup-2026-06-16.md` §4.2). Collapse calls with identical `toolName + input` in a safe batch to one execution and fan the single outcome out to every matching `toolCallId`. Read-only by construction (only safe tools batch), so it's a pure harness win. Each `toolCallId` still gets its own `tool_start` + `tool_result`, preserving pairing.

**Interfaces:** no API change to `runToolCalls`; internal behavior only.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/src/lib/engine/scheduler.test.ts` (inside the existing top-level `describe`, alongside the other `runToolCalls` tests):

```typescript
  test("dedupes identical safe calls in a round: one execution, fanned results", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return { ok: true };
      },
      isCommandAllowed: () => true,
    });
    // Two identical Grep calls (concurrency-safe) with distinct ids.
    const calls = [
      tc("Grep", { pattern: "x" }, "g1"),
      tc("Grep", { pattern: "x" }, "g2"),
    ];
    const events: SchedulerEvent[] = [];
    const gen = runToolCalls({
      toolCalls: calls,
      host,
      hooks: NOOP_ENGINE_HOOKS,
      getMode: () => "BUILD" as ModeType,
      loopGuard: new ToolLoopGuard(),
      alwaysAllowEdits: { get: () => false, set: () => {} },
    });
    while (true) {
      const r = await gen.next();
      if (r.done) break;
      events.push(r.value);
    }
    // Executed once, but both ids got a result.
    expect(executions).toBe(1);
    const resultIds = events
      .filter((e) => e.type === "tool_result")
      .map((e) => (e as { toolCallId: string }).toolCallId)
      .sort();
    expect(resultIds).toEqual(["g1", "g2"]);
  });

  test("distinct safe inputs are NOT deduped", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return { ok: true };
      },
    });
    const calls = [
      tc("Grep", { pattern: "x" }, "g1"),
      tc("Grep", { pattern: "y" }, "g2"),
    ];
    const gen = runToolCalls({
      toolCalls: calls,
      host,
      hooks: NOOP_ENGINE_HOOKS,
      getMode: () => "BUILD" as ModeType,
      loopGuard: new ToolLoopGuard(),
      alwaysAllowEdits: { get: () => false, set: () => {} },
    });
    while (!(await gen.next()).done) {}
    expect(executions).toBe(2);
  });
```

(If `ModeType` isn't already imported in this test file, it is — see line 2. `SchedulerEvent`, `ToolLoopGuard`, `NOOP_ENGINE_HOOKS`, `tc`, and `makeHost` are all already in scope.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/engine/scheduler.test.ts`
Expected: FAIL — the first new test sees `executions === 2` (both ran).

- [ ] **Step 3: Implement within-batch dedup**

In `packages/cli/src/lib/engine/scheduler.ts`, replace the safe-batch branch body (the `if (batch.safe && batch.calls.length > 1) { ... }` block, lines 247-272) with a version that executes each distinct `toolName + input` once and fans the outcome to every matching id:

```typescript
    if (batch.safe && batch.calls.length > 1) {
      // Collapse identical calls (same tool + input) to one execution, fanning
      // the single outcome to every matching toolCallId. Safe because only
      // concurrency-safe (read-only) tools reach this branch. Each id still
      // gets its own tool_start/tool_result so pairing is preserved.
      const groups = new Map<string, ToolCallRequest[]>();
      const order: string[] = [];
      for (const call of batch.calls) {
        const key = `${call.toolName}:${JSON.stringify(call.input ?? {})}`;
        const group = groups.get(key);
        if (group) {
          group.push(call);
        } else {
          groups.set(key, [call]);
          order.push(key);
        }
      }

      const channel = createChannel<SchedulerEvent>();
      const semaphore = createSemaphore(MAX_TOOL_CONCURRENCY);
      const work = Promise.all(
        order.map(async (key) => {
          const group = groups.get(key)!;
          const representative = group[0]!;
          await semaphore.acquire();
          try {
            if (params.abortSignal?.aborted) return;
            for (const call of group) {
              channel.push({ type: "tool_start", toolCall: call });
            }
            const outcome = await executeOne(representative, params, reminders);
            for (const call of group) {
              channel.push({
                type: "tool_result",
                toolCallId: call.toolCallId,
                outcome,
              });
            }
          } finally {
            semaphore.release();
          }
        }),
      );
      void work.then(
        () => channel.close(),
        () => channel.close(),
      );
      yield* channel.drain();
      await work;
    } else {
```

(The `else` branch — the serial path, lines 273-285 — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/engine/scheduler.test.ts`
Expected: PASS — `executions === 1` for identical calls, both ids resolved; distinct inputs still run twice.

- [ ] **Step 5: Type-check + full engine suite**

Run: `cd packages/cli && bun run check-types && bun test src/lib/engine`
Expected: clean / all pass (the existing concurrency + ordering tests still hold — distinct inputs are unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/engine/scheduler.ts packages/cli/src/lib/engine/scheduler.test.ts
git commit -m "feat(engine): dedupe identical safe tool calls within a round"
```

---

### Task 7: Recovery primitives (`recovery.ts`)

**Files:**
- Create: `packages/cli/src/lib/engine/recovery.ts`
- Test: `packages/cli/src/lib/engine/recovery.test.ts`

**Why:** Today any stream error throws straight to a terminal `error` (`query.ts:369-372`) — no retry, no backoff (`harness-followup-2026-06-16.md` §P4). This task ships the pure, fully-testable building blocks: classify retryable stream/network errors, honor `Retry-After`, compute exponential backoff, sleep abortably, and a generic `withRetry` wrapper. Task 8 wires them into the loop.

**Interfaces:**
- Produces:
  - `isRetryableError(err: unknown): boolean`
  - `getRetryAfterMs(err: unknown): number | null`
  - `backoffDelayMs(attempt: number, retryAfterMs?: number | null): number`
  - `sleep(ms: number, signal?: AbortSignal): Promise<void>`
  - `withRetry<T>(fn, opts): Promise<T>` — generic bounded retry (used by tests now; the natural fit for the Phase E subagent path).

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/lib/engine/recovery.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  isRetryableError,
  getRetryAfterMs,
  backoffDelayMs,
  sleep,
  withRetry,
} from "./recovery";

describe("recovery primitives", () => {
  it("classifies transient errors as retryable", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("model is overloaded"))).toBe(true);
  });

  it("classifies non-transient errors as non-retryable", () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError(new Error("invalid api key"))).toBe(false);
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    expect(isRetryableError(aborted)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("reads Retry-After seconds from response headers", () => {
    expect(getRetryAfterMs({ responseHeaders: { "retry-after": "2" } })).toBe(2000);
    expect(getRetryAfterMs(new Error("x"))).toBeNull();
  });

  it("computes capped exponential backoff", () => {
    expect(backoffDelayMs(0)).toBe(500);
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(10)).toBe(8000); // capped
    expect(backoffDelayMs(0, 3000)).toBe(3000); // Retry-After wins
    expect(backoffDelayMs(0, 99999)).toBe(8000); // but still capped
  });

  it("sleep(0) resolves and abort cuts it short", async () => {
    await sleep(0);
    const ctrl = new AbortController();
    ctrl.abort();
    await sleep(10000, ctrl.signal); // returns immediately, not after 10s
    expect(true).toBe(true);
  });

  it("withRetry retries a retryable failure then succeeds", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw { status: 503 };
        return "ok";
      },
      { maxRetries: 3, delayForAttempt: () => 0, onRetry: (i) => retries.push(i.attempt) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(retries).toEqual([1]);
  });

  it("withRetry gives up after maxRetries on persistent retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { status: 503 };
        },
        { maxRetries: 2, delayForAttempt: () => 0 },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("withRetry does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("invalid api key");
        },
        { maxRetries: 3, delayForAttempt: () => 0 },
      ),
    ).rejects.toThrow(/invalid api key/);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/engine/recovery.test.ts`
Expected: FAIL — `./recovery` not found.

- [ ] **Step 3: Implement the primitives**

Create `packages/cli/src/lib/engine/recovery.ts`:

```typescript
/**
 * Recovery primitives for transient model-stream failures: classify retryable
 * errors, honor Retry-After, compute bounded exponential backoff, sleep
 * abortably, and a generic withRetry wrapper. query.ts uses the primitives
 * directly around the streaming round (it yields UI events mid-stream, so it
 * can't delegate through withRetry); withRetry is the reusable form for
 * non-yielding callers (e.g. the Phase E subagent loop).
 */

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/** True for transient network/stream/server errors worth retrying. Never true
 *  for an AbortError (a deliberate cancel) or a client (4xx-except-429) error. */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  };
  if (e.name === "AbortError") return false;

  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (RETRYABLE_STATUS.has(status)) return true;
    if (status >= 400 && status < 500) return false; // client errors don't retry
  }
  if (typeof e.code === "string" && RETRYABLE_CODES.has(e.code)) return true;

  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("terminated") ||
    msg.includes("socket") ||
    msg.includes("stream error") ||
    msg.includes("overloaded") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("429")
  );
}

/** Retry-After (seconds or HTTP-date) from an error's response headers, in ms. */
export function getRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    responseHeaders?: Record<string, string>;
    headers?: Record<string, string>;
  };
  const headers = e.responseHeaders ?? e.headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/** Backoff for `attempt` (0-based): Retry-After if present, else 500·2^attempt,
 *  both capped at 8s. */
export function backoffDelayMs(
  attempt: number,
  retryAfterMs?: number | null,
): number {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_DELAY_MS);
  }
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

/** Resolve after `ms`, or immediately if `signal` is/aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `fn(attempt)` with bounded retries on retryable errors. `delayForAttempt`
 * defaults to backoffDelayMs (override with `() => 0` in tests). `onRetry` fires
 * before each wait. Rethrows immediately on a non-retryable error, on abort, or
 * after `maxRetries` retries.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    maxRetries?: number;
    signal?: AbortSignal;
    delayForAttempt?: (attempt: number, retryAfterMs: number | null) => number;
    onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const delayFor = opts.delayForAttempt ?? backoffDelayMs;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (
        attempt >= maxRetries ||
        opts.signal?.aborted ||
        !isRetryableError(err)
      ) {
        throw err;
      }
      const delayMs = delayFor(attempt, getRetryAfterMs(err));
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs, opts.signal);
      attempt++;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/engine/recovery.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check + commit**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

```bash
git add packages/cli/src/lib/engine/recovery.ts packages/cli/src/lib/engine/recovery.test.ts
git commit -m "feat(engine): recovery primitives (retry classification + backoff)"
```

---

### Task 8: Wire stream recovery into the query loop

**Files:**
- Modify: `packages/cli/src/lib/engine/events.ts` (add the `retry` EngineEvent + `maxStreamRetries` param)
- Modify: `packages/cli/src/lib/engine/query.ts` (retry loop around the per-round stream)
- Modify: `packages/cli/src/hooks/use-query-engine.ts` (optional `retry` status surface)
- Test: `packages/cli/src/lib/engine/query.test.ts`

**Why:** With the primitives in place, retry the per-round model stream on a transient failure **before any content is emitted**, and retry once on a genuinely **empty** response (`harness-followup-2026-06-16.md` §P4). Once text/reasoning/tool-call parts exist, an error stays terminal (retrying mid-stream would duplicate output / orphan tool pairs). The round's streaming section becomes an inner generator so a retry loop can `yield*`-delegate it and roll back partial parts between attempts.

**Interfaces:**
- Consumes: `isRetryableError`, `getRetryAfterMs`, `backoffDelayMs`, `sleep` (Task 7).
- Produces: `EngineEvent` gains `{ type: "retry"; attempt: number; delayMs: number; error: string }`; `QueryParams` gains `maxStreamRetries?: number` (default 2).

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/src/lib/engine/query.test.ts`. First, a model that fails the first stream with a retryable error, then succeeds — place it next to the other model factories (after `toolThenTextModel`, ~line 127):

```typescript
// First stream emits a retryable error part; second stream returns text.
function errorThenTextModel() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call++;
      if (call === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "error", error: new Error("service overloaded") },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "recovered" },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            finishReason: v3Finish("stop"),
            usage: v3Usage(10, 5),
          },
        ]),
      };
    },
  });
}
```

Then the tests (inside the `describe("query", ...)` block):

```typescript
  test("retries a transient stream error then completes", async () => {
    const { events, terminal } = await drain(
      query({
        ...baseParams(errorThenTextModel()),
        maxStreamRetries: 2,
      } as never),
    );
    expect(terminal.reason).toBe("complete");
    const retry = events.find((e) => e.type === "retry") as
      | { type: "retry"; attempt: number; error: string }
      | undefined;
    expect(retry).toBeDefined();
    expect(retry!.attempt).toBe(1);
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    const text = done.message.parts.find(
      (p) => (p as { type: string }).type === "text",
    ) as never as { text: string };
    expect(text.text).toBe("recovered"); // no duplicated "service overloaded" content
  });

  test("a non-retryable stream error is terminal (no retry)", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "error", error: new Error("invalid api key") },
        ]),
      }),
    });
    const { events, terminal } = await drain(
      query({ ...baseParams(model), maxStreamRetries: 2 } as never),
    );
    expect(terminal.reason).toBe("error");
    expect(events.some((e) => e.type === "retry")).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/engine/query.test.ts`
Expected: FAIL — no retry today, so `errorThenTextModel` ends in terminal `error` and there is no `retry` event.

- [ ] **Step 3: Extend the event + param types**

In `packages/cli/src/lib/engine/events.ts`, add the `retry` variant to `EngineEvent` (after the `mode_change` entry, around line 58):

```typescript
  /** A retryable stream failure (or empty response) — the round is being retried. */
  | { type: "retry"; attempt: number; delayMs: number; error: string }
```

And add the param to `QueryParams` (after `maxRounds`, around line 87):

```typescript
  /** Max retries for a transient stream failure / empty response per round
   *  (retries only happen before any content is emitted). Default 2. */
  maxStreamRetries?: number;
```

- [ ] **Step 4: Add the recovery import to `query.ts`**

In `packages/cli/src/lib/engine/query.ts`, add after the `tool-runner` import (line 28):

```typescript
import {
  backoffDelayMs,
  getRetryAfterMs,
  isRetryableError,
  sleep,
} from "./recovery";
```

- [ ] **Step 5: Wrap the round's stream in an inner generator + retry loop**

In `packages/cli/src/lib/engine/query.ts`, the section from `yield { type: "stream_start" };` (line 247) through the end of the `for await (const part of result.fullStream) { ... }` loop (line 376) currently runs once. Replace that section — from line 247 up to and including the closing `}` of the `for await` loop at line 376 — with an inner generator `runStream()` plus a retry loop that drives it. (The variable declarations for `toolCalls`/`activeText`/`activeReasoning`/`streamAborted` move inside `runStream`; everything after — the `if (streamAborted || abortSignal?.aborted)` block at line 378 onward — is unchanged and now reads `toolCalls`/`streamAborted` from the loop's result.)

Replace lines 247-376 with:

```typescript
      // One streaming attempt: (re)creates the model stream and folds its parts
      // into `assistant`, yielding the same UI events. Returns the round's tool
      // calls. Throws on a stream `error` part — the retry loop below decides
      // whether to retry (transient + nothing emitted yet) or rethrow.
      const runStream = async function* (): AsyncGenerator<
        EngineEvent,
        { toolCalls: ToolCallRequest[]; streamAborted: boolean }
      > {
        yield { type: "stream_start" };

        const result = streamText({
          model: resolved.model,
          system: buildSystemPrompt({
            mode,
            globalInstructions: ctx.globalInstructions,
            projectInstructions: ctx.projectInstructions,
            localInstructions: ctx.localInstructions,
            rules: ctx.rules,
            skillIndex: ctx.skillIndex,
            memoryIndex: ctx.memoryIndex,
            gitBranchName: ctx.gitBranchName,
            gitStatus: ctx.gitStatus,
            gitDiffSummary: ctx.gitDiffSummary,
            frameworks: ctx.frameworks,
            packageManager: ctx.packageManager,
            isTypeScript: ctx.isTypeScript,
            shellName: ctx.shellName,
            platform: ctx.platform,
            availableDeferredTools,
            agentTypes: ctx.agentTypes,
          }),
          messages: modelMessages,
          tools,
          providerOptions: resolved.providerOptions,
          abortSignal,
        });

        const toolCalls: ToolCallRequest[] = [];
        let activeText: { type: "text"; text: string } | null = null;
        let activeReasoning: { type: "reasoning"; text: string } | null = null;
        // streamText doesn't throw on abort mid-stream: it emits a graceful
        // `abort` part and ends the stream, so track it explicitly.
        let streamAborted = false;

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-start":
              activeText = { type: "text", text: "" };
              assistant.parts.push(activeText as never);
              break;
            case "text-delta":
              if (activeText) {
                activeText.text += part.text;
                yield { type: "message_update", message: snapshot(assistant) };
              }
              break;
            case "text-end":
              activeText = null;
              break;
            case "reasoning-start":
              activeReasoning = { type: "reasoning", text: "" };
              assistant.parts.push(activeReasoning as never);
              break;
            case "reasoning-delta":
              if (activeReasoning) {
                activeReasoning.text += part.text;
                yield { type: "message_update", message: snapshot(assistant) };
              }
              break;
            case "reasoning-end":
              activeReasoning = null;
              break;
            case "tool-call": {
              // Unparsable args or unknown tool: never execute — resolve the
              // part as an error immediately so the model can self-correct on
              // the next round instead of the executor (or worse, a later
              // history pass) choking on it.
              const invalid = (part as { invalid?: boolean }).invalid === true;
              if (invalid) {
                const reason = (part as { error?: unknown }).error;
                assistant.parts.push({
                  type: `tool-${part.toolName}`,
                  toolCallId: part.toolCallId,
                  state: "output-error",
                  input: part.input ?? {},
                  errorText: `Invalid tool call: ${
                    reason instanceof Error
                      ? reason.message
                      : String(reason ?? "unparsable arguments")
                  }`,
                } as never);
                yield { type: "message_update", message: snapshot(assistant) };
                break;
              }
              const toolCall: ToolCallRequest = {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              };
              toolCalls.push(toolCall);
              assistant.parts.push({
                type: `tool-${part.toolName}`,
                toolCallId: part.toolCallId,
                state: "input-available",
                input: part.input,
              } as never);
              yield { type: "message_update", message: snapshot(assistant) };
              break;
            }
            case "finish-step": {
              // OpenRouter surfaces the real per-request cost on the step's
              // provider metadata (usage accounting). One step per round, so sum
              // across rounds. Defensive optional-chaining: other providers / a
              // disabled flag simply leave it absent.
              const orUsage = (
                part.providerMetadata as
                  | { openrouter?: { usage?: { cost?: number } } }
                  | undefined
              )?.openrouter?.usage;
              if (
                typeof orUsage?.cost === "number" &&
                Number.isFinite(orUsage.cost)
              ) {
                costUsd += orUsage.cost;
                costReported = true;
              }
              break;
            }
            case "finish":
              usage = addUsage(usage, part.totalUsage);
              break;
            case "abort":
              streamAborted = true;
              break;
            case "error":
              throw part.error instanceof Error
                ? part.error
                : new Error(String(part.error));
            default:
              break;
          }
        }

        return { toolCalls, streamAborted };
      };

      // Retry the stream on a transient failure or empty response, but only
      // while NOTHING has been emitted this round — once content exists, a retry
      // would duplicate output / orphan tool pairs, so the error stays terminal.
      const partsBase = assistant.parts.length;
      const maxStreamRetries = params.maxStreamRetries ?? 2;
      let toolCalls: ToolCallRequest[];
      let streamAborted: boolean;
      for (let attempt = 0; ; attempt++) {
        try {
          const out = yield* runStream();
          const emittedContent = assistant.parts.length > partsBase;
          // Empty response (no content, not aborted): retry once like a transient
          // failure; otherwise accept it (the model legitimately said nothing).
          if (
            !emittedContent &&
            !out.streamAborted &&
            !abortSignal?.aborted &&
            attempt < maxStreamRetries
          ) {
            const delayMs = backoffDelayMs(attempt);
            yield {
              type: "retry",
              attempt: attempt + 1,
              delayMs,
              error: "empty response",
            };
            await sleep(delayMs, abortSignal);
            continue;
          }
          toolCalls = out.toolCalls;
          streamAborted = out.streamAborted;
          break;
        } catch (err) {
          const emittedContent = assistant.parts.length > partsBase;
          const canRetry =
            !emittedContent &&
            attempt < maxStreamRetries &&
            !abortSignal?.aborted &&
            isRetryableError(err);
          if (!canRetry) throw err;
          // Drop any partial parts from the failed attempt before retrying.
          assistant.parts.length = partsBase;
          const delayMs = backoffDelayMs(attempt, getRetryAfterMs(err));
          yield {
            type: "retry",
            attempt: attempt + 1,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
          };
          await sleep(delayMs, abortSignal);
        }
      }
```

The existing `if (streamAborted || abortSignal?.aborted) { ... }` block (previously line 378) and everything after it stays exactly as-is — it now reads the `toolCalls`/`streamAborted` bound by the retry loop.

- [ ] **Step 6: (Optional) surface the retry in the UI consumer**

In `packages/cli/src/hooks/use-query-engine.ts`, the event `switch` (line 568) already has a `default: break;`, so the new event is safe without a change. For visibility, optionally add a case before `default` (line 593):

```typescript
              case "retry":
                setStatus("streaming");
                break;
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/engine/query.test.ts`
Expected: PASS — the transient case retries (one `retry` event, `attempt === 1`, final text `"recovered"`); the `invalid api key` case is terminal with no `retry` event. (The retry waits one real backoff of ~500ms — acceptable for a single test.)

- [ ] **Step 8: Type-check + full suite**

Run: `cd packages/cli && bun run check-types && bun test`
Expected: clean / all pass. (Existing query tests are unaffected: they emit content immediately, so the retry loop takes the success path on attempt 0.)

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/lib/engine/events.ts packages/cli/src/lib/engine/query.ts packages/cli/src/hooks/use-query-engine.ts packages/cli/src/lib/engine/query.test.ts
git commit -m "feat(engine): retry transient stream failures and empty responses"
```

---

## Self-Review

**1. Spec coverage** (Phase D changeset, `docs/knightcode-upgrade-plan-2026-06-16.md:380-405`, Slice 1 = ledger + dedup + loop-guard + recovery):
- "NEW `lib/engine/recovery.ts` — `withRetry` + bounded exponential backoff + Retry-After + classify retryable stream errors; emit a `retry` EngineEvent" → Tasks 7 (primitives + `withRetry`) + 8 (`retry` event + wiring).
- "wrap the `streamText` round in `withRetry`; on empty response retry once" → Task 8 (primitives-based retry loop — wrapper deviation documented; empty-response retry included).
- "EDIT `events.ts` — add `retry` event" → Task 8.
- "NEW `lib/engine/file-ledger.ts` — session `Map<resolvedPath,{mtimeMs}>`" → Task 1 (located at `lib/tools/shared/file-ledger.ts` to sit beside its twin `session-snapshot.ts` and the path resolver the tools share — deviation noted).
- "EDIT `Read/execute.ts` + Bash read paths — record on success" → Task 2 (Read). Bash recording **deferred** (documented in Global Constraints — Bash `ctx` lacks `sessionId`; low value).
- "EDIT `{Edit,MultiEdit,Write,NotebookEdit}/execute.ts` OR central precondition — 'read it first' / 'modified since read'; update ledger after write" → Task 3 (per-tool placement, justified: a tool throw is already converted to a uniform `output-error` by the scheduler, so the doc's reason for centralizing is already satisfied; tools already compute `resolved`; the scheduler has no `executionRoot`).
- "seeded from the transcript on resume" (`harness-followup` §3) → Task 4.
- "EDIT `tool-runner.ts` — lower `LOOP_LIMIT` 8→3" → Task 5.
- "within-round dedup of identical safe calls in `scheduler.ts`" → Task 6.
- "TEST recovery (overflow→compact→continue), ledger (read-before-edit + staleness), dedup" → ledger + staleness (Tasks 1, 3), dedup (Task 6), recovery (Tasks 7, 8). The "overflow→compact→continue" portion is **compaction**, explicitly Slice 2 (not this plan).

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step shows complete content. The one large replacement (Task 8, Step 5) reproduces the full stream-switch verbatim rather than referencing the original, since the engineer may read tasks out of order.

**3. Type consistency:**
- `recordRead` / `recordWrite` / `assertWritable` / `clearFileLedger` / `getLedgerEntry` / `seedFileLedgerFromTranscript` — defined Tasks 1 & 4, consumed Tasks 2, 3, 4 + their tests. ✓
- `assertWritable(sessionId, resolvedPath, { allowCreate })` — `allowCreate: true` only on `Write` (Task 3, Step 5); the other three omit it. ✓
- `isRetryableError` / `getRetryAfterMs` / `backoffDelayMs` / `sleep` / `withRetry` — defined Task 7, consumed Task 8 + tests. `withRetry`'s `delayForAttempt` override exists (Task 7) and is used by the Task 7 tests. ✓
- `EngineEvent` `retry` variant shape `{ type, attempt, delayMs, error }` — defined Task 8 Step 3, produced in Task 8 Step 5, consumed in Task 8 Steps 6-7 + tests. ✓
- `QueryParams.maxStreamRetries` — defined Task 8 Step 3, read in Task 8 Step 5, supplied by the Task 8 tests. ✓
- `ToolLoopGuard.check` signature unchanged (Task 5 changes only the constant). ✓
- Scheduler dedup keeps `runToolCalls`'s public generator type; only the safe-batch internals change (Task 6). ✓

**Deliberate deviations (with reasons):** all four are restated in Global Constraints — ledger location beside `session-snapshot.ts`; per-tool guard (uniform-error already guaranteed by the scheduler); primitives-not-`withRetry` at the yielding stream site; Bash read-recording deferred. In-loop compaction is out of scope for Slice 1 by the user's choice and the docs' sequencing.
