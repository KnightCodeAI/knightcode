# npm-release Foundation (Plan A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@knightcode/cli` runnable as a self-contained `bun build --compile` binary — migrations embedded (no file-based migrator), a `--version` flag, a headless `knightcode doctor`, and a non-blocking update-check banner — validated by compiling and running the binary locally.

**Architecture:** Migrations are injected at build time via `Bun.build({ define })` and run through a small inline transactional runner against `bun:sqlite`; in dev the same loader falls back to reading `.sql` from disk. The TUI entry (`index.tsx`) dispatches `--version` / `doctor` to headless code paths _before_ mounting the renderer. A minimal single-platform `scripts/build.ts` proves the compile path; running that binary is the GO/NO-GO gate for Plan B (distribution).

**Tech Stack:** Bun 1.3.3, `bun:sqlite`, drizzle-orm (schema/query only — not the migrator), OpenTUI/React, TypeScript, `bun test`.

**Source spec:** `docs/superpowers/specs/2026-06-05-npm-release-design.md` (§1, §2, §5, §6, §9).

**Scope note:** This plan deliberately stops at a locally-validated binary. Platform packages, the launcher, Changesets, and CI are Plan B. The `dotenv` block in `bin/knightcode` and the `@knightcode/shared` workspace dep are left untouched here — they only matter for the published package and are handled in Plan B.

---

## File Structure

| File                                                    | Responsibility                                                                                | Created/Modified |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| `packages/cli/src/env.d.ts`                             | Ambient declarations for build-time constants (`KNIGHTCODE_VERSION`, `KNIGHTCODE_MIGRATIONS`) | Create           |
| `packages/cli/src/lib/store/migrations.ts`              | `Migration` type + `loadMigrations()` (define-or-disk) + `readMigrationsFromDisk()`           | Create           |
| `packages/cli/src/lib/store/run-migrations.ts`          | Inline transactional migration runner over `bun:sqlite`                                       | Create           |
| `packages/cli/src/lib/store/client.ts`                  | Wire the new loader+runner in; drop the drizzle file migrator                                 | Modify           |
| `packages/cli/src/lib/version.ts`                       | `VERSION` constant (define-or-dev-fallback)                                                   | Create           |
| `packages/cli/src/lib/cli/parse-args.ts`                | Pure argv → `{ kind: "version" \| "doctor" \| "tui" }`                                        | Create           |
| `packages/cli/src/lib/doctor/checks.ts`                 | `runDoctorChecks()` pure diagnostics, shared by dialog + headless                             | Create           |
| `packages/cli/src/lib/doctor/format.ts`                 | `formatDoctorReport()` → plain-text block + exit code                                         | Create           |
| `packages/cli/src/lib/doctor/run-headless.ts`           | `runDoctorHeadless()` — print report, return exit code                                        | Create           |
| `packages/cli/src/components/dialogs/doctor-dialog.tsx` | Refactor to consume `runDoctorChecks()`                                                       | Modify           |
| `packages/cli/src/index.tsx`                            | Dispatch `version`/`doctor` headlessly before mounting TUI                                    | Modify           |
| `packages/cli/src/lib/update/cache.ts`                  | Read/write `~/.knightcode/update-check.json`                                                  | Create           |
| `packages/cli/src/lib/update/check.ts`                  | `isNewerVersion`, `getAvailableUpdate`, `maybeRefreshUpdateCache`                             | Create           |
| `packages/cli/src/hooks/use-update-check.ts`            | `useUpdateCheck()` — cache read + one background refresh                                      | Create           |
| `packages/cli/src/components/status-bar.tsx`            | Append `★ vX available` when an update exists                                                 | Modify           |
| `packages/cli/src/screens/home.tsx`                     | Dim update line under the hints row                                                           | Modify           |
| `scripts/build.ts`                                      | Minimal programmatic `Bun.build` compile (single platform via `--single`)                     | Create           |

---

## Task 1: Ambient build-time constants

**Files:**

- Create: `packages/cli/src/env.d.ts`

- [ ] **Step 1: Declare the constants**

```ts
// packages/cli/src/env.d.ts
// Build-time constants substituted by Bun.build({ define }) in scripts/build.ts.
// Undeclared at runtime in dev — always read behind a `typeof … !== "undefined"`
// guard so the dev fallback path runs without a ReferenceError.
declare const KNIGHTCODE_VERSION: string;
declare const KNIGHTCODE_MIGRATIONS:
  | { id: string; hash: string; sql: string }[]
  | undefined;
```

- [ ] **Step 2: Verify types still compile**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS (no new errors; the file is picked up by `src/**` in tsconfig).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/env.d.ts
git commit -m "chore(cli): declare build-time constants for compiled binary"
```

---

## Task 2: Migration loader (define-or-disk)

**Files:**

- Create: `packages/cli/src/lib/store/migrations.ts`
- Test: `packages/cli/src/lib/store/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/store/migrations.test.ts
import { describe, expect, test } from "bun:test";
import { readMigrationsFromDisk } from "./migrations";

describe("readMigrationsFromDisk", () => {
  test("reads the real migration directory", () => {
    const migrations = readMigrationsFromDisk();
    expect(migrations.length).toBeGreaterThan(0);
    const first = migrations[0]!;
    expect(first.id).toBe("0000_majestic_prima");
    expect(first.sql).toContain("CREATE TABLE");
    // sha-256 hex digest is 64 chars
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is sorted by id", () => {
    const ids = readMigrationsFromDisk().map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/store/migrations.test.ts`
Expected: FAIL — `Cannot find module './migrations'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/store/migrations.ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Migration = { id: string; hash: string; sql: string };

/**
 * Read every `.sql` file under `migrations/`, sorted by filename, hashing each.
 * Used in dev (and tests). The compiled binary uses the embedded array instead.
 */
export function readMigrationsFromDisk(
  dir: string = join(dirname(fileURLToPath(import.meta.url)), "migrations"),
): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf-8");
      return {
        id: file.replace(/\.sql$/, ""),
        hash: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    });
}

/**
 * The migrations to apply. In the compiled binary `KNIGHTCODE_MIGRATIONS` is
 * substituted with the embedded array; in dev it is an undeclared global, so the
 * `typeof` guard takes the disk path.
 */
export function loadMigrations(): Migration[] {
  if (typeof KNIGHTCODE_MIGRATIONS !== "undefined") {
    return KNIGHTCODE_MIGRATIONS;
  }
  return readMigrationsFromDisk();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/store/migrations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/store/migrations.ts packages/cli/src/lib/store/migrations.test.ts
git commit -m "feat(cli): migration loader with embed-or-disk fallback"
```

---

## Task 3: Inline transactional migration runner

**Files:**

- Create: `packages/cli/src/lib/store/run-migrations.ts`
- Test: `packages/cli/src/lib/store/run-migrations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/store/run-migrations.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./run-migrations";
import type { Migration } from "./migrations";

const M = (id: string, sql: string): Migration => ({
  id,
  sql,
  hash: `hash-${id}`,
});

describe("runMigrations", () => {
  test("applies a migration and records it", () => {
    const db = new Database(":memory:");
    runMigrations(db, [M("0001", "CREATE TABLE a (x INTEGER);")]);
    const rows = db
      .query("SELECT id, hash FROM __knightcode_migrations")
      .all() as { id: string; hash: string }[];
    expect(rows).toEqual([{ id: "0001", hash: "hash-0001" }]);
    // table really exists
    db.exec("INSERT INTO a (x) VALUES (1);");
  });

  test("is idempotent — second run applies nothing new", () => {
    const db = new Database(":memory:");
    const migs = [M("0001", "CREATE TABLE a (x INTEGER);")];
    runMigrations(db, migs);
    runMigrations(db, migs); // must not throw "table a already exists"
    const count = db
      .query("SELECT COUNT(*) AS n FROM __knightcode_migrations")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  test("throws on hash mismatch for an applied id", () => {
    const db = new Database(":memory:");
    runMigrations(db, [M("0001", "CREATE TABLE a (x INTEGER);")]);
    expect(() =>
      runMigrations(db, [
        { id: "0001", hash: "DIFFERENT", sql: "CREATE TABLE a (x INTEGER);" },
      ]),
    ).toThrow(/hash mismatch/);
  });

  test("rolls back a failed migration — nothing recorded, db unchanged", () => {
    const db = new Database(":memory:");
    expect(() =>
      runMigrations(db, [
        M("0001", "CREATE TABLE a (x INTEGER); INSERT INTO nope VALUES (1);"),
      ]),
    ).toThrow();
    const recorded = db
      .query("SELECT COUNT(*) AS n FROM __knightcode_migrations")
      .get() as { n: number };
    expect(recorded.n).toBe(0);
    // The CREATE TABLE a from the failed migration must have been rolled back.
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='a'")
      .all();
    expect(tables).toEqual([]);
  });

  test("applies migrations in id order regardless of input order", () => {
    const db = new Database(":memory:");
    runMigrations(db, [
      M("0002", "CREATE TABLE b (y INTEGER);"),
      M("0001", "CREATE TABLE a (x INTEGER);"),
    ]);
    const ids = (
      db.query("SELECT id FROM __knightcode_migrations ORDER BY id").all() as {
        id: string;
      }[]
    ).map((r) => r.id);
    expect(ids).toEqual(["0001", "0002"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/store/run-migrations.test.ts`
Expected: FAIL — `Cannot find module './run-migrations'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/store/run-migrations.ts
import type { Database } from "bun:sqlite";
import type { Migration } from "./migrations";

const TABLE = "__knightcode_migrations";

/**
 * Apply pending migrations against a raw bun:sqlite Database. Each unapplied
 * migration runs inside an explicit transaction: if its SQL throws, the whole
 * migration is rolled back and its row is never inserted, so the db never lands
 * in a half-migrated state. Already-applied ids are verified by hash to catch a
 * db written by an incompatible build.
 */
export function runMigrations(db: Database, migrations: Migration[]): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, hash TEXT NOT NULL);`,
  );

  const applied = new Map<string, string>();
  for (const row of db.query(`SELECT id, hash FROM ${TABLE}`).all() as {
    id: string;
    hash: string;
  }[]) {
    applied.set(row.id, row.hash);
  }

  const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  for (const m of sorted) {
    const existingHash = applied.get(m.id);
    if (existingHash !== undefined) {
      if (existingHash !== m.hash) {
        throw new Error(
          `Migration ${m.id} hash mismatch — database may be from an incompatible version`,
        );
      }
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.run(`INSERT INTO ${TABLE} (id, hash) VALUES (?, ?)`, [m.id, m.hash]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/store/run-migrations.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/store/run-migrations.ts packages/cli/src/lib/store/run-migrations.test.ts
git commit -m "feat(cli): inline transactional sqlite migration runner"
```

---

## Task 4: Wire the runner into the store client

**Files:**

- Modify: `packages/cli/src/lib/store/client.ts`

- [ ] **Step 1: Replace the drizzle migrator with the inline runner**

Replace the imports and the `createStore` body. The full new file:

```ts
// packages/cli/src/lib/store/client.ts
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { knightcodeHome } from "../paths";
import { loadMigrations } from "./migrations";
import { runMigrations } from "./run-migrations";
import * as schema from "./schema";

export type Store = BunSQLiteDatabase<typeof schema>;

export function getDefaultDbPath(): string {
  return join(knightcodeHome(), "knightcode.db");
}

/**
 * Open (creating if needed) the local sqlite store and apply pending
 * migrations. Pass ":memory:" for an ephemeral test db. bun:sqlite and the
 * inline migration runner are synchronous, so this returns a ready db.
 */
export function createStore(dbPath: string = getDefaultDbPath()): Store {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(dbPath, { create: true });
  // Tighten the db file (session/message history) to owner-only. The parent dir
  // is already 0700; this is defense-in-depth (POSIX; skipped on Windows).
  if (dbPath !== ":memory:" && process.platform !== "win32") {
    chmodSync(dbPath, 0o600);
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  runMigrations(sqlite, loadMigrations());
  return drizzle(sqlite, { schema });
}

let cachedStore: Store | undefined;

/** Process-wide lazy singleton over the default db path. */
export function getStore(): Store {
  if (!cachedStore) cachedStore = createStore();
  return cachedStore;
}
```

Note removed: `fileURLToPath`, `MIGRATIONS_DIR`, `migrate` import, and the
`migrationsFolder` call.

- [ ] **Step 2: Run the full store test suite + the existing conversation/session tests**

Run: `bun test packages/cli/src/lib/store/`
Expected: PASS — existing tests that call `createStore(":memory:")` still get a fully-migrated db (now via the inline runner). If any test imported the removed `MIGRATIONS_DIR`, fix it (none should — it was module-private).

- [ ] **Step 3: Type-check**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/lib/store/client.ts
git commit -m "refactor(cli): run migrations via inline runner instead of drizzle file migrator"
```

---

## Task 4b: Baseline-adopt databases from the old drizzle migrator

**Added after implementation:** a DB created by the previous drizzle file-migrator
has the app schema (`session`/`message`) plus a legacy `__drizzle_migrations`
table, but an empty `__knightcode_migrations`. The new runner would see migration
`0000` as unapplied and re-run `CREATE TABLE message`, which throws. This task
makes the runner adopt such a DB: if our tracking table is empty but
`__drizzle_migrations` records N applied migrations, the first N of ours (same
files, same sorted order) are recorded as applied **without re-running**.
Migrations beyond N apply normally. Fresh installs are unaffected (no legacy table).

**Files:**

- Modify: `packages/cli/src/lib/store/run-migrations.ts`
- Test: `packages/cli/src/lib/store/run-migrations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// add to run-migrations.test.ts
test("adopts a legacy drizzle DB without re-running migrations", () => {
  const db = new Database(":memory:");
  // Simulate a DB migrated by the old drizzle migrator: schema present, a
  // legacy tracking table with one applied row, no __knightcode_migrations.
  db.exec("CREATE TABLE message (x INTEGER);");
  db.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC);",
  );
  db.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
    "legacyhash",
    1,
  ]);
  // Our migration 0000 would CREATE TABLE message — would throw without adoption.
  runMigrations(db, [M("0000", "CREATE TABLE message (x INTEGER);")]);
  const rows = db.query("SELECT id FROM __knightcode_migrations").all() as {
    id: string;
  }[];
  expect(rows.map((r) => r.id)).toEqual(["0000"]);
});

test("adopts the first N legacy migrations and applies the rest", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE message (x INTEGER);"); // 0000's target already exists
  db.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC);",
  );
  db.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
    "legacyhash",
    1,
  ]);
  // Legacy applied 1 migration → adopt 0000, then apply the new 0001.
  runMigrations(db, [
    M("0000", "CREATE TABLE message (x INTEGER);"),
    M("0001", "CREATE TABLE extra (y INTEGER);"),
  ]);
  const ids = (
    db.query("SELECT id FROM __knightcode_migrations ORDER BY id").all() as {
      id: string;
    }[]
  ).map((r) => r.id);
  expect(ids).toEqual(["0000", "0001"]);
  db.exec("INSERT INTO extra (y) VALUES (1);"); // 0001 really ran
});

test("fresh DB (no legacy table) runs migrations normally", () => {
  const db = new Database(":memory:");
  runMigrations(db, [M("0000", "CREATE TABLE message (x INTEGER);")]);
  const rows = db.query("SELECT id FROM __knightcode_migrations").all() as {
    id: string;
  }[];
  expect(rows.map((r) => r.id)).toEqual(["0000"]);
  db.exec("INSERT INTO message (x) VALUES (1);"); // table really created
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `bun test packages/cli/src/lib/store/run-migrations.test.ts`
Expected: the first test FAILS with `table message already exists` (no adoption yet).

- [ ] **Step 3: Add baseline adoption to the runner**

In `run-migrations.ts`, after building `applied` and `sorted`, before the apply
loop, insert the adoption block, and add the helper:

```ts
// One-time adoption of a DB created by the previous (drizzle) migrator: if our
// tracking table is empty but a legacy __drizzle_migrations table records N
// applied migrations, the first N of ours (same files, same order) are already
// applied — record them without re-running so the existing schema isn't
// recreated. Anything beyond N applies normally below. Fresh DBs skip this.
if (applied.size === 0) {
  const legacyCount = countLegacyMigrations(db);
  for (let i = 0; i < Math.min(legacyCount, sorted.length); i++) {
    const m = sorted[i]!;
    db.run(`INSERT INTO ${TABLE} (id, hash) VALUES (?, ?)`, [m.id, m.hash]);
    applied.set(m.id, m.hash);
  }
}
```

```ts
function countLegacyMigrations(db: Database): number {
  const exists = db
    .query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
    )
    .get();
  if (!exists) return 0;
  const row = db
    .query(`SELECT COUNT(*) AS c FROM __drizzle_migrations`)
    .get() as { c: number };
  return row.c;
}
```

- [ ] **Step 4: Run to verify all tests pass**

Run: `bun test packages/cli/src/lib/store/run-migrations.test.ts`
Expected: PASS (8 tests — 5 original + 3 new).

- [ ] **Step 5: Verify against the real legacy DB**

The maintainer's `~/.knightcode/knightcode.db` is a real legacy DB. Confirm the
store now opens against it:

Run: `bun packages/cli/src/index.tsx doctor`
Expected: "Local store ready", exit 0 (previously failed with `table 'message'
already exists`).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/store/run-migrations.ts packages/cli/src/lib/store/run-migrations.test.ts
git commit -m "feat(cli): adopt databases migrated by the legacy drizzle migrator"
```

---

## Task 5: Version constant

**Files:**

- Create: `packages/cli/src/lib/version.ts`
- Test: `packages/cli/src/lib/version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/version.test.ts
import { expect, test } from "bun:test";
import { VERSION } from "./version";

test("VERSION is a non-empty string (dev fallback in test runs)", () => {
  expect(typeof VERSION).toBe("string");
  expect(VERSION.length).toBeGreaterThan(0);
  // No build define under `bun test`, so we get the dev fallback.
  expect(VERSION).toBe("0.0.0-dev");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/version.test.ts`
Expected: FAIL — `Cannot find module './version'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/version.ts
/**
 * The CLI version. In the compiled binary `KNIGHTCODE_VERSION` is substituted by
 * Bun.build({ define }); in dev it is undeclared, so we fall back to a dev marker.
 */
export const VERSION: string =
  typeof KNIGHTCODE_VERSION !== "undefined" ? KNIGHTCODE_VERSION : "0.0.0-dev";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/version.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/version.ts packages/cli/src/lib/version.test.ts
git commit -m "feat(cli): build-injected VERSION constant with dev fallback"
```

---

## Task 6: CLI argument parser

**Files:**

- Create: `packages/cli/src/lib/cli/parse-args.ts`
- Test: `packages/cli/src/lib/cli/parse-args.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/cli/parse-args.test.ts
import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./parse-args";

describe("parseCliArgs", () => {
  test("no args → tui", () => {
    expect(parseCliArgs([])).toEqual({ kind: "tui" });
  });
  test("--version / -v → version", () => {
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });
  test("doctor subcommand → doctor", () => {
    expect(parseCliArgs(["doctor"])).toEqual({ kind: "doctor" });
  });
  test("--version wins over doctor when both present", () => {
    expect(parseCliArgs(["doctor", "--version"])).toEqual({ kind: "version" });
  });
  test("unknown args → tui", () => {
    expect(parseCliArgs(["--whatever"])).toEqual({ kind: "tui" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/cli/parse-args.test.ts`
Expected: FAIL — `Cannot find module './parse-args'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/cli/parse-args.ts
export type CliCommand =
  | { kind: "version" }
  | { kind: "doctor" }
  | { kind: "tui" };

/** Map process.argv.slice(2) to a top-level command. Version is checked first. */
export function parseCliArgs(argv: string[]): CliCommand {
  if (argv.includes("--version") || argv.includes("-v")) {
    return { kind: "version" };
  }
  if (argv[0] === "doctor") {
    return { kind: "doctor" };
  }
  return { kind: "tui" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/cli/parse-args.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/cli/parse-args.ts packages/cli/src/lib/cli/parse-args.test.ts
git commit -m "feat(cli): parse --version and doctor as top-level commands"
```

---

## Task 7: Doctor checks as a shared pure function

**Files:**

- Create: `packages/cli/src/lib/doctor/checks.ts`
- Test: `packages/cli/src/lib/doctor/checks.test.ts`

Extract the diagnostics currently inlined in `doctor-dialog.tsx` so both the
dialog and the headless command share one implementation. A missing API key is a
`warn` (expected on a fresh machine), not a `fail` — this keeps `doctor`'s exit
code green in CI where no key is configured.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/doctor/checks.test.ts
import { describe, expect, test } from "bun:test";
import { runDoctorChecks } from "./checks";

describe("runDoctorChecks", () => {
  test("returns one entry per known check with a valid status", () => {
    const checks = runDoctorChecks();
    const labels = checks.map((c) => c.label);
    expect(labels).toContain("OpenRouter API key");
    expect(labels).toContain("Local store");
    expect(labels).toContain("Git available");
    expect(labels).toContain("Runtime");
    for (const c of checks) {
      expect(["ok", "warn", "fail"]).toContain(c.status);
    }
  });

  test("missing API key is a warn, never a fail", () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    // Point config at an empty temp dir so no credentials.json key is found.
    const prevHome = process.env.KNIGHTCODE_HOME;
    process.env.KNIGHTCODE_HOME = `${process.cwd()}/.tmp-doctor-${Date.now()}`;
    try {
      const key = runDoctorChecks().find(
        (c) => c.label === "OpenRouter API key",
      );
      expect(key?.status).toBe("warn");
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
      if (prevHome !== undefined) process.env.KNIGHTCODE_HOME = prevHome;
      else delete process.env.KNIGHTCODE_HOME;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/doctor/checks.test.ts`
Expected: FAIL — `Cannot find module './checks'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/doctor/checks.ts
import { spawnSync } from "node:child_process";
import { getOpenRouterApiKey } from "../credentials";
import { listSessions } from "../store";
import { getStore } from "../store/client";

export type CheckStatus = "ok" | "warn" | "fail";
export type DoctorCheck = {
  label: string;
  status: CheckStatus;
  detail?: string;
};

/**
 * Synchronous diagnostics shared by the /doctor dialog and the headless
 * `knightcode doctor` command. A missing API key is a warn (expected on a fresh
 * install), so it does not turn the headless exit code red.
 */
export function runDoctorChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // 1. OpenRouter API key
  if (getOpenRouterApiKey()) {
    checks.push({
      label: "OpenRouter API key",
      status: "ok",
      detail: "configured",
    });
  } else {
    checks.push({
      label: "OpenRouter API key",
      status: "warn",
      detail: "not configured (run: knightcode)",
    });
  }

  // 2. Local store
  try {
    listSessions(getStore(), process.cwd());
    checks.push({ label: "Local store", status: "ok", detail: "ready" });
  } catch (err) {
    checks.push({
      label: "Local store",
      status: "fail",
      detail: err instanceof Error ? err.message : "unavailable",
    });
  }

  // 3. Git available
  const git = spawnSync("git", ["--version"], { encoding: "utf-8" });
  if (git.status === 0) {
    checks.push({
      label: "Git available",
      status: "ok",
      detail: git.stdout.trim(),
    });
  } else {
    checks.push({
      label: "Git available",
      status: "warn",
      detail: "git not found in PATH",
    });
  }

  // 4. Runtime
  const runtime =
    typeof Bun !== "undefined"
      ? `Bun ${(globalThis as { Bun: { version: string } }).Bun.version}`
      : `Node ${process.version}`;
  checks.push({ label: "Runtime", status: "ok", detail: runtime });

  return checks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/doctor/checks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/doctor/checks.ts packages/cli/src/lib/doctor/checks.test.ts
git commit -m "feat(cli): extract shared doctor checks; missing key is warn not fail"
```

---

## Task 8: Doctor report formatter

**Files:**

- Create: `packages/cli/src/lib/doctor/format.ts`
- Test: `packages/cli/src/lib/doctor/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/doctor/format.test.ts
import { describe, expect, test } from "bun:test";
import { formatDoctorReport, doctorExitCode } from "./format";
import type { DoctorCheck } from "./checks";

const checks: DoctorCheck[] = [
  { label: "OpenRouter API key", status: "warn", detail: "not configured" },
  { label: "Local store", status: "ok", detail: "ready" },
];

describe("formatDoctorReport", () => {
  test("includes a version + platform header and every check line", () => {
    const out = formatDoctorReport("0.1.0", checks);
    expect(out).toContain("knightcode 0.1.0");
    expect(out).toContain(`${process.platform}-${process.arch}`);
    expect(out).toContain("OpenRouter API key");
    expect(out).toContain("not configured");
    expect(out).toContain("Local store");
  });
});

describe("doctorExitCode", () => {
  test("0 when no check failed (warns are fine)", () => {
    expect(doctorExitCode(checks)).toBe(0);
  });
  test("1 when any check failed", () => {
    expect(
      doctorExitCode([...checks, { label: "Local store", status: "fail" }]),
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/doctor/format.test.ts`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/doctor/format.ts
import type { CheckStatus, DoctorCheck } from "./checks";

const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

/** Plain-text diagnostic block for `knightcode doctor` (no TUI, no color). */
export function formatDoctorReport(
  version: string,
  checks: DoctorCheck[],
): string {
  const lines = [
    `knightcode ${version}`,
    `platform: ${process.platform}-${process.arch}`,
    "",
  ];
  const width = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    const label = c.label.padEnd(width);
    const detail = c.detail ? `  ${c.detail}` : "";
    lines.push(`${ICON[c.status]} ${label}${detail}`);
  }
  return lines.join("\n");
}

/** Exit 1 only when a check structurally failed; warns stay green. */
export function doctorExitCode(checks: DoctorCheck[]): number {
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/doctor/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/doctor/format.ts packages/cli/src/lib/doctor/format.test.ts
git commit -m "feat(cli): plain-text doctor report formatter + exit code"
```

---

## Task 9: Headless doctor runner

**Files:**

- Create: `packages/cli/src/lib/doctor/run-headless.ts`

This is a thin orchestrator (print + return code); the formatting and checks it
composes are already unit-tested, so it has no separate test.

- [ ] **Step 1: Write the implementation**

```ts
// packages/cli/src/lib/doctor/run-headless.ts
import { VERSION } from "../version";
import { runDoctorChecks } from "./checks";
import { doctorExitCode, formatDoctorReport } from "./format";

/** Run diagnostics, print the report to stdout, and return the process exit code. */
export function runDoctorHeadless(): number {
  const checks = runDoctorChecks();
  process.stdout.write(formatDoctorReport(VERSION, checks) + "\n");
  return doctorExitCode(checks);
}
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/lib/doctor/run-headless.ts
git commit -m "feat(cli): headless doctor runner"
```

---

## Task 10: Refactor the doctor dialog onto the shared checks

**Files:**

- Modify: `packages/cli/src/components/dialogs/doctor-dialog.tsx`

Keep the dialog's look; just source its data from `runDoctorChecks()` so the logic
lives in one place. (Progressive per-check "pending" animation is dropped — the
checks are synchronous and fast.)

- [ ] **Step 1: Rewrite the dialog body**

```tsx
// packages/cli/src/components/dialogs/doctor-dialog.tsx
import { useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { runDoctorChecks, type CheckStatus } from "../../lib/doctor/checks";
import { useTheme } from "../../providers/theme";

function statusColor(
  s: CheckStatus,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (s) {
    case "ok":
      return colors.success;
    case "warn":
      return colors.warning;
    case "fail":
      return colors.error;
  }
}

function statusIcon(s: CheckStatus): string {
  switch (s) {
    case "ok":
      return "✓";
    case "warn":
      return "!";
    case "fail":
      return "✗";
  }
}

export function DoctorDialogContent() {
  const { colors } = useTheme();
  const checks = useMemo(() => runDoctorChecks(), []);

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>Knightcode diagnostics</text>
      {checks.map((check) => (
        <box key={check.label} flexDirection="row" gap={2}>
          <text fg={statusColor(check.status, colors)}>
            {statusIcon(check.status)}
          </text>
          <box width={22} flexShrink={0}>
            <text>{check.label}</text>
          </box>
          {check.detail && (
            <text attributes={TextAttributes.DIM}>{check.detail}</text>
          )}
        </box>
      ))}
    </box>
  );
}
```

- [ ] **Step 2: Type-check + confirm nothing else imported the old internals**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS. (The dialog's previous `Check`/`statusColor` types were local; the
command registry imports only `DoctorDialogContent`, which is unchanged.)

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/components/dialogs/doctor-dialog.tsx
git commit -m "refactor(cli): doctor dialog reuses shared checks"
```

---

## Task 11: Dispatch version/doctor before mounting the TUI

**Files:**

- Modify: `packages/cli/src/index.tsx`

The TUI setup must not run for headless commands. Add the dispatch at the very top,
after the exit-guard import (which must stay first), and wrap the renderer setup so
it only runs for the `tui` command.

- [ ] **Step 1: Add the headless dispatch**

Immediately after the existing first line
(`import { markIntentionalExit, isIntentionalExit } from "./lib/exit-guard";`),
insert:

```tsx
import { parseCliArgs } from "./lib/cli/parse-args";
import { VERSION } from "./lib/version";
import { runDoctorHeadless } from "./lib/doctor/run-headless";

const command = parseCliArgs(process.argv.slice(2));
if (command.kind === "version") {
  process.stdout.write(VERSION + "\n");
  process.exit(0);
}
if (command.kind === "doctor") {
  process.exit(runDoctorHeadless());
}
```

This sits above `createCliRenderer(...)`, so neither headless path mounts the TUI.
Because both branches call `process.exit`, the rest of the module (renderer, router,
heartbeat) only runs for the default `tui` command — no further restructuring needed.

- [ ] **Step 2: Verify the TUI still starts in dev**

Run: `bun run --filter @knightcode/cli dev`
Expected: TUI mounts as before. Quit with Ctrl+C twice. (No automated test —
this is the interactive entry; the parser and doctor pieces are unit-tested.)

- [ ] **Step 3: Verify headless paths in dev**

Run: `bun packages/cli/src/index.tsx --version`
Expected: prints `0.0.0-dev` and exits 0.

Run: `bun packages/cli/src/index.tsx doctor`
Expected: prints the diagnostic block, exits 0 (warn on key is fine).

- [ ] **Step 4: Type-check + commit**

```bash
bun run --filter @knightcode/cli check-types
git add packages/cli/src/index.tsx
git commit -m "feat(cli): dispatch --version and doctor headlessly before TUI mount"
```

---

## Task 12: Update-check cache

**Files:**

- Create: `packages/cli/src/lib/update/cache.ts`
- Test: `packages/cli/src/lib/update/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/update/cache.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUpdateCache, writeUpdateCache } from "./cache";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.KNIGHTCODE_HOME;
  home = mkdtempSync(join(tmpdir(), "kc-update-"));
  process.env.KNIGHTCODE_HOME = home;
});

afterEach(() => {
  if (prevHome !== undefined) process.env.KNIGHTCODE_HOME = prevHome;
  else delete process.env.KNIGHTCODE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("update cache", () => {
  test("returns null when no cache file exists", () => {
    expect(readUpdateCache()).toBeNull();
  });

  test("round-trips a written cache", () => {
    writeUpdateCache({ lastChecked: 123, latestVersion: "9.9.9" });
    expect(readUpdateCache()).toEqual({
      lastChecked: 123,
      latestVersion: "9.9.9",
    });
  });

  test("returns null on malformed json", () => {
    writeUpdateCache({ lastChecked: 1, latestVersion: "1.0.0" });
    // Corrupt the file
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(home, "update-check.json"), "{not json");
    expect(readUpdateCache()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/update/cache.test.ts`
Expected: FAIL — `Cannot find module './cache'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/update/cache.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { knightcodeHome } from "../paths";

export type UpdateCache = { lastChecked: number; latestVersion: string };

export function getUpdateCachePath(): string {
  return join(knightcodeHome(), "update-check.json");
}

export function readUpdateCache(): UpdateCache | null {
  try {
    const raw = JSON.parse(
      readFileSync(getUpdateCachePath(), "utf-8"),
    ) as unknown;
    if (
      raw &&
      typeof raw === "object" &&
      typeof (raw as UpdateCache).lastChecked === "number" &&
      typeof (raw as UpdateCache).latestVersion === "string"
    ) {
      return raw as UpdateCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeUpdateCache(cache: UpdateCache): void {
  const dir = knightcodeHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(getUpdateCachePath(), JSON.stringify(cache, null, 2), "utf-8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/update/cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/update/cache.ts packages/cli/src/lib/update/cache.test.ts
git commit -m "feat(cli): update-check cache read/write"
```

---

## Task 13: Update-check logic

**Files:**

- Create: `packages/cli/src/lib/update/check.ts`
- Test: `packages/cli/src/lib/update/check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/update/check.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewerVersion, getAvailableUpdate } from "./check";
import { writeUpdateCache } from "./cache";

describe("isNewerVersion", () => {
  test("compares semver numerically", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true); // not lexical
  });
  test("dev/garbage current → never prompts", () => {
    expect(isNewerVersion("1.0.0", "0.0.0-dev")).toBe(true);
    expect(isNewerVersion("garbage", "0.1.0")).toBe(false);
  });
});

describe("getAvailableUpdate", () => {
  let home: string;
  let prevHome: string | undefined;
  beforeEach(() => {
    prevHome = process.env.KNIGHTCODE_HOME;
    home = mkdtempSync(join(tmpdir(), "kc-upd-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    if (prevHome !== undefined) process.env.KNIGHTCODE_HOME = prevHome;
    else delete process.env.KNIGHTCODE_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  test("null when no cache", () => {
    expect(getAvailableUpdate("0.1.0")).toBeNull();
  });
  test("returns cached latest when newer", () => {
    writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.2.0" });
    expect(getAvailableUpdate("0.1.0")).toBe("0.2.0");
  });
  test("null when cached latest is not newer", () => {
    writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.1.0" });
    expect(getAvailableUpdate("0.1.0")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/lib/update/check.test.ts`
Expected: FAIL — `Cannot find module './check'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/lib/update/check.ts
import { readUpdateCache, writeUpdateCache } from "./cache";

const REGISTRY_URL = "https://registry.npmjs.org/@knightcode/cli/latest";
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True if `latest` is strictly greater than `current` (semver major.minor.patch). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Cached latest version if it is newer than `current`, else null. Never fetches. */
export function getAvailableUpdate(current: string): string | null {
  const cache = readUpdateCache();
  if (cache && isNewerVersion(cache.latestVersion, current)) {
    return cache.latestVersion;
  }
  return null;
}

let refreshedThisProcess = false;

/**
 * Fire-and-forget background refresh of the cache for the *next* launch. Never
 * blocks startup, never throws. Skipped when KNIGHTCODE_NO_UPDATE_CHECK is set,
 * when refreshed already this process, or when the cache is still fresh (<24h).
 */
export function maybeRefreshUpdateCache(): void {
  if (refreshedThisProcess) return;
  refreshedThisProcess = true;
  if (process.env.KNIGHTCODE_NO_UPDATE_CHECK) return;

  const cache = readUpdateCache();
  if (cache && Date.now() - cache.lastChecked < TTL_MS) return;

  void (async () => {
    try {
      const res = await fetch(REGISTRY_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: unknown };
      if (typeof body.version === "string") {
        writeUpdateCache({
          lastChecked: Date.now(),
          latestVersion: body.version,
        });
      }
    } catch {
      // Offline / slow / malformed — stale cache is fine.
    }
  })();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/lib/update/check.test.ts`
Expected: PASS (5 tests). (No network is hit — `maybeRefreshUpdateCache` is not
exercised by these tests, only the pure read paths.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/update/check.ts packages/cli/src/lib/update/check.test.ts
git commit -m "feat(cli): non-blocking update-check logic (cache-first, background refresh)"
```

---

## Task 14: useUpdateCheck hook

**Files:**

- Create: `packages/cli/src/hooks/use-update-check.ts`

Thin React wrapper: read the cache once on mount and kick the background refresh.
`maybeRefreshUpdateCache` is process-idempotent, so it is safe to call from both
the status bar and the home screen.

- [ ] **Step 1: Write the implementation**

```ts
// packages/cli/src/hooks/use-update-check.ts
import { useEffect, useState } from "react";
import { VERSION } from "../lib/version";
import {
  getAvailableUpdate,
  maybeRefreshUpdateCache,
} from "../lib/update/check";

/** Latest available version string if an update is cached, else null. */
export function useUpdateCheck(): string | null {
  const [available] = useState(() => getAvailableUpdate(VERSION));
  useEffect(() => {
    maybeRefreshUpdateCache();
  }, []);
  return available;
}
```

- [ ] **Step 2: Type-check + commit**

```bash
bun run --filter @knightcode/cli check-types
git add packages/cli/src/hooks/use-update-check.ts
git commit -m "feat(cli): useUpdateCheck hook"
```

---

## Task 15: Status bar update indicator

**Files:**

- Modify: `packages/cli/src/components/status-bar.tsx`

- [ ] **Step 1: Consume the hook and append the indicator**

Add the import near the other imports:

```tsx
import { useUpdateCheck } from "../hooks/use-update-check";
```

Inside `StatusBar`, after `const { colors } = useTheme();`, add:

```tsx
const updateVersion = useUpdateCheck();
```

Then, immediately before the closing `</box>` of the returned row (right after the
`ctx ? (...) : null` block), add:

```tsx
{
  updateVersion ? (
    <>
      {sep}
      <text fg={colors.success}>★ v{updateVersion} available</text>
    </>
  ) : null;
}
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS.

- [ ] **Step 3: Manual check (optional, via seeded cache)**

Seed a fake newer version, then run dev and confirm the status bar shows
`★ v99.0.0 available`:

```bash
# PowerShell
mkdir $env:USERPROFILE\.knightcode -Force | Out-Null
'{ "lastChecked": 9999999999999, "latestVersion": "99.0.0" }' | Out-File -Encoding utf8 $env:USERPROFILE\.knightcode\update-check.json
bun run --filter @knightcode/cli dev
```

(The far-future `lastChecked` keeps the background refresh from overwriting it.)
Remove the file afterward.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/components/status-bar.tsx
git commit -m "feat(cli): show update availability in the status bar"
```

---

## Task 16: Home screen update line

**Files:**

- Modify: `packages/cli/src/screens/home.tsx`

- [ ] **Step 1: Add the dim update line under the hints row**

Add the import:

```tsx
import { useUpdateCheck } from "../hooks/use-update-check";
```

Inside `Home`, after `const { mode, model, reasoningEffort } = usePromptConfig();`,
add:

```tsx
const updateVersion = useUpdateCheck();
```

Then, immediately after the hints `<box flexDirection="row" …>…</box>` (the row
containing "/ for commands"), add a sibling:

```tsx
{
  updateVersion ? (
    <box flexDirection="row" flexShrink={0} paddingLeft={1}>
      <text fg={colors.success} attributes={TextAttributes.DIM}>
        ★ Update available: v{updateVersion} • npm install -g @knightcode/cli
      </text>
    </box>
  ) : null;
}
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/screens/home.tsx
git commit -m "feat(cli): show update availability on the home screen"
```

---

## Task 17: Minimal single-platform build script

**Files:**

- Create: `scripts/build.ts`

A first cut of the build orchestrator: compile the **current** platform only (via
`--single`), embedding version + migrations through `define`, writing into a local
`dist/` for the validation gate. Plan B extends this to the full platform matrix
and writes into the platform package folders.

- [ ] **Step 1: Write the build script**

```ts
// scripts/build.ts — run with `bun run scripts/build.ts [--single]`
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";
import { readMigrationsFromDisk } from "../packages/cli/src/lib/store/migrations";

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "packages/cli/src/index.tsx");

type Target = { os: string; arch: string; bunTarget: string };

const ALL_TARGETS: Target[] = [
  { os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { os: "win32", arch: "x64", bunTarget: "bun-windows-x64" },
];

const single = process.argv.includes("--single");
const targets = single
  ? ALL_TARGETS.filter(
      (t) => t.os === process.platform && t.arch === process.arch,
    )
  : ALL_TARGETS;

if (targets.length === 0) {
  console.error(`No build target for ${process.platform}-${process.arch}`);
  process.exit(1);
}

// package.json has no typed `version` field yet (added in Plan B) — read defensively.
const version = (pkg as { version?: string }).version ?? "0.0.0-dev";
const migrations = readMigrationsFromDisk();
console.log(`Embedding ${migrations.length} migration(s), version ${version}`);

for (const target of targets) {
  const outDir = join(ROOT, "dist", `${target.os}-${target.arch}`);
  mkdirSync(outDir, { recursive: true });
  const binName = target.os === "win32" ? "knightcode.exe" : "knightcode";
  const outfile = join(outDir, binName);

  console.log(`Building ${target.os}-${target.arch} → ${outfile}`);
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    // Bun validates the platform triple at build time; the static union type is
    // narrower than our runtime list, so cast.
    compile: { target: target.bunTarget as never, outfile },
    define: {
      KNIGHTCODE_VERSION: JSON.stringify(version),
      KNIGHTCODE_MIGRATIONS: JSON.stringify(migrations),
    },
  });

  if (!result.success) {
    console.error(`Build failed for ${target.os}-${target.arch}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

console.log("Build complete.");
```

Notes for the implementer:

- `pkg.version` is currently absent from `packages/cli/package.json` — it defaults
  to `0.0.0-dev` here. Plan B sets a real `version` and removes `"private": true`.
- `JSON.stringify(version)` yields `"0.1.0"` (a quoted string literal) — correct
  for a `define` substituting a `string` constant.
- `JSON.stringify(migrations)` yields a JS array literal — correct for the
  `Migration[]` constant.
- If `Bun.build`'s `compile.target` typing rejects the dynamic string, cast via
  `as never` is acceptable; the value is validated by Bun at build time.

- [ ] **Step 2: Type-check the script**

Run: `bunx tsc --noEmit scripts/build.ts` (or rely on the build run in Task 18).
Expected: no type errors. If `compile.target` complains, apply the cast noted above.

- [ ] **Step 3: Commit**

```bash
git add scripts/build.ts
git commit -m "feat(build): minimal single-platform compile with embedded version + migrations"
```

---

## Task 18: GO/NO-GO validation gate (spec §9)

**Files:** none (validation only — throwaway artifacts in `dist/`).

This is the decision point for Plan B. Build the current-platform binary and verify
every spec §9 check. If any fail, **stop** and fix the foundation before touching
distribution.

- [ ] **Step 1: Build the current-platform binary**

Run: `bun run scripts/build.ts --single`
Expected: `Build complete.` and a binary at `dist/<platform>-<arch>/knightcode[.exe]`.

- [ ] **Step 2: `--version` (define injection works)**

Run (PowerShell): `& .\dist\win32-x64\knightcode.exe --version`
Expected: prints `0.0.0-dev` (the package has no version yet) and exits 0.
This proves `KNIGHTCODE_VERSION` substitution survived `--compile`.

- [ ] **Step 3: `doctor` (headless path + embedded migrations + sqlite)**

Run: `& .\dist\win32-x64\knightcode.exe doctor`
Expected: the diagnostic block prints; "Local store" shows `ready` (proving the
**embedded** migrations ran against `bun:sqlite` inside the compiled binary — the
single highest-risk check); exits 0.

- [ ] **Step 4: TUI renders + config dir created**

Run: `& .\dist\win32-x64\knightcode.exe`
Expected: the TUI mounts, the home screen renders, and `~/.knightcode/` exists
(`knightcode.db` created). Submit a prompt if a key is configured to confirm
OpenRouter streaming works post-compile. Quit with Ctrl+C twice.

- [ ] **Step 5: Record the result**

If all checks pass on this platform, the compile approach is validated — proceed to
Plan B (which adds the remaining platforms in CI). If a check fails, capture the
error; the most likely culprits are `bun:sqlite` or OpenTUI behaving differently
under `--compile`, which must be resolved before distribution work.

No commit (no source changes). Optionally clear artifacts:

```bash
# PowerShell
Remove-Item -Recurse -Force .\dist
```

---

## Task 19: Full suite + type-check sweep

**Files:** none.

- [ ] **Step 1: Run the whole CLI test suite**

Run: `bun test packages/cli/src`
Expected: PASS — all new suites (migrations, run-migrations, version, parse-args,
doctor checks/format, update cache/check) plus the pre-existing tests.

- [ ] **Step 2: Type-check the package**

Run: `bun run --filter @knightcode/cli check-types`
Expected: PASS.

- [ ] **Step 3: Format**

Run: `bun run format`
Expected: clean. Commit any formatting-only changes:

```bash
git add -A
git commit -m "chore: format npm-release foundation"
```

---

## Self-Review (spec coverage)

| Spec section                                                                       | Covered by              |
| ---------------------------------------------------------------------------------- | ----------------------- |
| §1 Migration embedding (define-or-disk)                                            | Tasks 1, 2, 17          |
| §1 Version injection (programmatic Bun.build)                                      | Tasks 1, 5, 17          |
| §2 Migration runner (transactional)                                                | Task 3, wired in Task 4 |
| §5 `--version` flag                                                                | Tasks 5, 6, 11          |
| §5 Update check (cache-first, non-blocking)                                        | Tasks 12, 13, 14        |
| §5 Status bar + home banners                                                       | Tasks 15, 16            |
| §6 `knightcode doctor` (headless)                                                  | Tasks 6, 7, 8, 9, 11    |
| §9 Pre-implementation spike (GO/NO-GO gate)                                        | Task 18                 |
| §3 Platform packages, §4 launcher, §7 CI, §8 Changesets, §10 README, §11 checklist | **Plan B** (deferred)   |

**Deferred to Plan B (not gaps):** removing `"private": true` + setting `version`,
the `optionalDependencies`/`engines`/`files` fields, the `bin/knightcode`
`require.resolve` launcher and `dotenv` removal, the full platform build matrix,
stub platform packages, Changesets config, `.github/workflows/publish.yml`,
`pack-test` job, and `packages/cli/README.md`.
