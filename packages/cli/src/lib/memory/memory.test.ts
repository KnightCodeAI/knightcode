import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { encodeProjectPath, getMemoryDir } from "./paths";
import {
  parseMemoryFrontmatter,
  readMemoryIndex,
  scanMemoryFiles,
  stripFrontmatter,
} from "./scan";
import { extractJsonArray } from "./json";
import { latestUserText } from "../engine/context-providers";
import type { Message } from "../engine/messages";
import {
  createMemoryRecallProvider,
  findRelevantMemories,
} from "./recall";
import { extractMemories, hasExtractableSignal } from "./extract";
import {
  deleteMemory,
  slugifyMemoryName,
  upsertMemory,
} from "./store";
import { execute as memoryToolExecute } from "../tools/Memory/execute";
import {
  scheduleMemoryExtraction,
  __setExtractorForTest,
} from "./extract-scheduler";
import {
  readLastConsolidatedAt,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from "./consolidation-lock";
import { maybeRunConsolidation, isAutoDreamEnabled } from "./auto-dream";
import { setSettingValue } from "../settings";
import { readFileSync } from "fs";
import { getMemoryIndexPath } from "./paths";

const tick = () => new Promise((r) => setTimeout(r, 0));

// Best-effort temp-dir cleanup. A test that touches the session store opens a
// process-wide cached sqlite handle in the temp home that can't be removed
// while open (EBUSY on Windows); leaking one temp dir is harmless, so swallow.
const rmHome = (dir: string) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // handle held by the singleton store; OS will reap the temp dir
  }
};

describe("encodeProjectPath", () => {
  // Case-insensitive match: the slug is case-folded on win32/darwin.
  test("turns separators and drive colon into dashes, with a hash suffix", () => {
    expect(encodeProjectPath("C:\\Users\\x\\proj")).toMatch(
      /^c-users-x-proj-[0-9a-f]{8}$/i,
    );
    expect(encodeProjectPath("/home/x/proj")).toMatch(
      /^home-x-proj-[0-9a-f]{8}$/i,
    );
  });
  test("is stable across slash styles for the same directory", () => {
    expect(encodeProjectPath("C:\\Users\\x\\proj")).toBe(
      encodeProjectPath("C:/Users/x/proj"),
    );
  });
  test("distinguishes directories that slugify identically", () => {
    // `/a/b` and `/a-b` both slugify to `a-b`; the hash keeps them apart.
    expect(encodeProjectPath("/a/b")).not.toBe(encodeProjectPath("/a-b"));
  });
  test("maps case-variant paths per the platform's filesystem semantics", () => {
    const caseInsensitive =
      process.platform === "win32" || process.platform === "darwin";
    if (caseInsensitive) {
      // Same directory on a case-insensitive FS → one store.
      expect(encodeProjectPath("/Proj/App")).toBe(
        encodeProjectPath("/proj/app"),
      );
    } else {
      // Genuinely distinct directories on a case-sensitive FS → separate stores.
      expect(encodeProjectPath("/Proj/App")).not.toBe(
        encodeProjectPath("/proj/app"),
      );
    }
  });
  test("bounds the encoded folder name length for deep paths", () => {
    const deep =
      "/" + Array.from({ length: 300 }, (_, i) => `segment-${i}`).join("/");
    const enc = encodeProjectPath(deep);
    expect(enc.length).toBeLessThanOrEqual(255);
    expect(enc).toMatch(/-[0-9a-f]{8}$/); // hash suffix preserved
  });
});

describe("parseMemoryFrontmatter", () => {
  test("reads name, description, nested metadata.type", () => {
    const raw = `---\nname: my-fact\ndescription: a thing\nmetadata:\n  type: feedback\n---\n\nbody here`;
    expect(parseMemoryFrontmatter(raw)).toEqual({
      name: "my-fact",
      description: "a thing",
      type: "feedback",
    });
  });
  test("ignores unknown types", () => {
    const raw = `---\nname: x\nmetadata:\n  type: bogus\n---\nbody`;
    expect(parseMemoryFrontmatter(raw).type).toBeUndefined();
  });
  test("no frontmatter → empty", () => {
    expect(parseMemoryFrontmatter("just text")).toEqual({});
  });
});

describe("stripFrontmatter", () => {
  test("removes the leading block", () => {
    expect(stripFrontmatter(`---\nname: x\n---\nhello`)).toBe("hello");
    // a blank line after the block is preserved (callers .trim())
    expect(stripFrontmatter(`---\nname: x\n---\n\nhello`).trim()).toBe("hello");
  });
});

describe("extractJsonArray", () => {
  test("parses a bare array", () => {
    expect(extractJsonArray('["a.md","b.md"]')).toEqual(["a.md", "b.md"]);
  });
  test("parses an array wrapped in prose / fences", () => {
    expect(extractJsonArray('Here you go:\n```json\n["a.md"]\n```')).toEqual([
      "a.md",
    ]);
  });
  test("garbage → empty", () => {
    expect(extractJsonArray("no array here")).toEqual([]);
  });
  test("stops at the matching close bracket, ignoring trailing prose", () => {
    expect(extractJsonArray('["a.md","b.md"]. See also [other].')).toEqual([
      "a.md",
      "b.md",
    ]);
  });
  test("handles nested arrays and brackets inside strings", () => {
    expect(extractJsonArray('Result: [["x"],["a]b"]] done')).toEqual([
      ["x"],
      ["a]b"],
    ]);
  });
});

describe("latestUserText", () => {
  test("returns the most recent user message's joined text", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "first" }] },
      { role: "assistant", parts: [{ type: "text", text: "reply" }] },
      {
        role: "user",
        parts: [
          { type: "text", text: "second" },
          { type: "text", text: "line" },
        ],
      },
    ] as unknown as Message[];
    expect(latestUserText(messages)).toBe("second\nline");
  });
  test("no user message → empty", () => {
    expect(latestUserText([] as Message[])).toBe("");
  });
});

describe("scan + index (filesystem)", () => {
  let home: string;
  const cwd = "/proj/demo";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-mem-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  test("scanMemoryFiles reads headers and excludes MEMORY.md", () => {
    const dir = getMemoryDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "a.md"),
      `---\nname: a\ndescription: first\nmetadata:\n  type: user\n---\nbody a`,
    );
    writeFileSync(
      join(dir, "b.md"),
      `---\nname: b\ndescription: second\nmetadata:\n  type: project\n---\nbody b`,
    );
    writeFileSync(join(dir, "MEMORY.md"), `# Memory Index\n- a\n- b`);

    const headers = scanMemoryFiles(cwd);
    expect(headers.map((h) => h.filename).sort()).toEqual(["a.md", "b.md"]);
    expect(headers.find((h) => h.filename === "a.md")?.description).toBe(
      "first",
    );
  });

  test("scanMemoryFiles → [] when dir absent", () => {
    expect(scanMemoryFiles("/nope/missing")).toEqual([]);
  });

  test("readMemoryIndex returns trimmed content / undefined", () => {
    expect(readMemoryIndex(cwd)).toBeUndefined();
    const dir = getMemoryDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "MEMORY.md"), `# Memory Index\n- [a](a.md) — x\n`);
    expect(readMemoryIndex(cwd)).toBe("# Memory Index\n- [a](a.md) — x");
  });
});

describe("hasExtractableSignal", () => {
  test("true for a substantive user message, false for greetings", () => {
    const sub = [
      { role: "user", parts: [{ type: "text", text: "always run the tests before committing" }] },
    ] as unknown as Message[];
    const trivial = [
      { role: "user", parts: [{ type: "text", text: "ok" }] },
    ] as unknown as Message[];
    expect(hasExtractableSignal(sub)).toBe(true);
    expect(hasExtractableSignal(trivial)).toBe(false);
  });
});

describe("recall + extract (mocked side query)", () => {
  let home: string;
  const cwd = "/proj/mp";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-mem-mp-"));
    process.env.KNIGHTCODE_HOME = home;
    const dir = getMemoryDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "a.md"),
      `---\nname: a\ndescription: about A\nmetadata:\n  type: user\n---\nbody a`,
    );
    writeFileSync(
      join(dir, "b.md"),
      `---\nname: b\ndescription: about B\nmetadata:\n  type: project\n---\nbody b`,
    );
  });
  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  test("findRelevantMemories maps selected filenames to headers", async () => {
    const selected = await findRelevantMemories({
      query: "tell me about A",
      cwd,
      mainModelId: "x/y",
      sideQueryImpl: async () => '```json\n["a.md"]\n```',
    });
    expect(selected.map((m) => m.filename)).toEqual(["a.md"]);
  });

  test("recall provider caches identical consecutive queries", async () => {
    let calls = 0;
    const provider = createMemoryRecallProvider({
      mainModelId: "x/y",
      sideQueryImpl: async () => {
        calls++;
        return '["a.md"]';
      },
    });
    const messages = [
      { role: "user", parts: [{ type: "text", text: "about A please" }] },
    ] as unknown as Message[];
    expect(provider.phase).toBe("turn_start");
    const first = await provider.run({ messages, cwd });
    const second = await provider.run({ messages, cwd });
    expect(calls).toBe(1);
    expect(first).toEqual(second);
    expect(first[0]).toContain("body a");
  });

  test("extractMemories runs the forked agent with the extraction prompt", async () => {
    let received: Message[] | null = null;
    const n = await extractMemories({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "never use spaces, only tabs, in this repo" },
          ],
        },
        { role: "assistant", parts: [{ type: "text", text: "Got it." }] },
      ] as unknown as Message[],
      cwd,
      mainModelId: "x/y",
      runner: async ({ messages }) => {
        received = messages;
        return 2;
      },
    });
    expect(n).toBe(2);
    const last = received![received!.length - 1]!;
    expect((last.parts[0] as { text: string }).text).toContain(
      "memory extraction subagent",
    );
  });

  test("extractMemories skips trivial turns (runner not called)", async () => {
    let called = false;
    const n = await extractMemories({
      messages: [
        { role: "user", parts: [{ type: "text", text: "ok" }] },
      ] as unknown as Message[],
      cwd,
      mainModelId: "x/y",
      runner: async () => {
        called = true;
        return 1;
      },
    });
    expect(n).toBe(0);
    expect(called).toBe(false);
  });

  test("extractMemories skips when the turn already wrote memory", async () => {
    let called = false;
    const n = await extractMemories({
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "remember I prefer tabs over spaces" }],
        },
        {
          role: "assistant",
          parts: [
            {
              type: "tool-Memory",
              toolCallId: "t1",
              state: "output-available",
              input: { action: "update", name: "tabs" },
              output: { success: true },
            },
          ],
        },
      ] as unknown as Message[],
      cwd,
      mainModelId: "x/y",
      runner: async () => {
        called = true;
        return 1;
      },
    });
    expect(n).toBe(0);
    expect(called).toBe(false);
  });
});

describe("store + Memory tool (filesystem)", () => {
  let home: string;
  const cwd = "/proj/store";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-mem-store-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  test("slugifyMemoryName normalizes names and filenames", () => {
    expect(slugifyMemoryName("Use Tabs Not Spaces")).toBe("use-tabs-not-spaces");
    expect(slugifyMemoryName("foo.md")).toBe("foo");
  });

  test("upsert writes, skips identical, then delete removes + reindexes", () => {
    expect(
      upsertMemory(cwd, {
        name: "tabs",
        description: "use tabs",
        type: "feedback",
        body: "Always tabs.",
      }),
    ).toBe(true);
    // identical body → no-op
    expect(
      upsertMemory(cwd, {
        name: "tabs",
        description: "use tabs",
        type: "feedback",
        body: "Always tabs.",
      }),
    ).toBe(false);
    expect(readMemoryIndex(cwd)).toContain("tabs");

    expect(deleteMemory(cwd, "tabs")).toBe(true);
    expect(deleteMemory(cwd, "tabs")).toBe(false); // already gone
    expect(scanMemoryFiles(cwd)).toEqual([]);
  });

  test("Memory tool: list / update / delete round-trip", async () => {
    const ctx = { executionRoot: cwd };

    const empty = (await memoryToolExecute({ action: "list" }, ctx)) as {
      count: number;
    };
    expect(empty.count).toBe(0);

    const upd = (await memoryToolExecute(
      {
        action: "update",
        name: "prefers-bun",
        description: "uses bun",
        type: "user",
        body: "User runs bun, not npm.",
      },
      ctx,
    )) as { success: boolean };
    expect(upd.success).toBe(true);

    const listed = (await memoryToolExecute({ action: "list" }, ctx)) as {
      count: number;
      memories: { name: string }[];
    };
    expect(listed.count).toBe(1);
    expect(listed.memories[0]!.name).toBe("prefers-bun");

    const del = (await memoryToolExecute(
      { action: "delete", name: "prefers-bun" },
      ctx,
    )) as { success: boolean };
    expect(del.success).toBe(true);
    expect(
      ((await memoryToolExecute({ action: "list" }, ctx)) as { count: number })
        .count,
    ).toBe(0);
  });

  test("Memory tool: update without a description is rejected (no empty index entry)", async () => {
    const ctx = { executionRoot: cwd };
    const res = (await memoryToolExecute(
      { action: "update", name: "no-desc", type: "user", body: "some body" },
      ctx,
    )) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("description");
    expect(
      ((await memoryToolExecute({ action: "list" }, ctx)) as { count: number })
        .count,
    ).toBe(0);
  });

  test("Memory tool: delete of a missing name fails cleanly", async () => {
    const res = (await memoryToolExecute(
      { action: "delete", name: "nope" },
      { executionRoot: cwd },
    )) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("No memory");
  });
});

describe("extraction scheduler (serialize + coalesce)", () => {
  const params = {
    messages: [] as unknown as Message[],
    cwd: "/x",
    mainModelId: "m",
  };
  afterEach(() => __setExtractorForTest());

  test("serializes overlapping schedules and coalesces to one trailing run", async () => {
    let active = 0;
    let maxActive = 0;
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;

    __setExtractorForTest(async (p) => {
      active++;
      maxActive = Math.max(maxActive, active);
      calls.push((p as { tag?: string }).tag ?? "?");
      if (first) {
        first = false;
        await gate; // hold the first run open while more arrive
      }
      active--;
      return 0;
    });

    scheduleMemoryExtraction({ ...params, tag: "a" } as never);
    scheduleMemoryExtraction({ ...params, tag: "b" } as never); // stashed
    scheduleMemoryExtraction({ ...params, tag: "c" } as never); // supersedes b
    await tick();
    expect(active).toBe(1); // only one in flight while first is held

    release();
    await tick();
    await tick();

    expect(maxActive).toBe(1); // never two at once
    expect(calls).toEqual(["a", "c"]); // b was superseded by c
  });

  test("fires onSaved only when memories were written", async () => {
    __setExtractorForTest(async () => 3);
    let saved = 0;
    scheduleMemoryExtraction(params, (n) => (saved = n));
    await tick();
    expect(saved).toBe(3);
  });
});

describe("consolidation lock", () => {
  let home: string;
  const cwd = "/proj/lock";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-mem-lock-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    rmHome(home);
  });

  test("acquire stamps mtime; readLastConsolidatedAt reflects it", () => {
    expect(readLastConsolidatedAt(cwd)).toBe(0);
    const prior = tryAcquireConsolidationLock(cwd);
    expect(prior).toBe(0); // no prior lock
    expect(readLastConsolidatedAt(cwd)).toBeGreaterThan(0);
  });

  test("rollback to 0 removes the lock (time-gate reopens)", () => {
    tryAcquireConsolidationLock(cwd);
    expect(readLastConsolidatedAt(cwd)).toBeGreaterThan(0);
    rollbackConsolidationLock(cwd, 0);
    expect(readLastConsolidatedAt(cwd)).toBe(0);
  });

  test("a process reclaims its own (self-pid) lock", () => {
    // The acquire guard skips our own pid, so a second acquire by the same
    // process within the stale window reclaims the lock rather than blocking.
    tryAcquireConsolidationLock(cwd);
    const second = tryAcquireConsolidationLock(cwd);
    expect(second).not.toBeNull(); // our own pid is reclaimable
  });

  test("a foreign live holder blocks re-acquire", async () => {
    // Spawn a real, long-lived process so its pid is foreign-but-alive — this
    // exercises the blocking branch the self-pid test cannot reach.
    const child = spawn(
      process.execPath,
      ["-e", "setTimeout(function () {}, 100000)"],
      { stdio: "ignore" },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    try {
      const dir = getMemoryDir(cwd);
      mkdirSync(dir, { recursive: true });
      // Fresh mtime (now) keeps the lock inside the stale window; the body is a
      // foreign, live pid, so acquire must refuse.
      writeFileSync(join(dir, ".consolidate-lock"), String(child.pid));
      expect(tryAcquireConsolidationLock(cwd)).toBeNull();
    } finally {
      child.kill();
    }
  });
});

describe("auto-dream gates", () => {
  let home: string;
  const cwd = "/proj/dream";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-mem-dream-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    rmHome(home);
  });

  test("disabled by default", () => {
    expect(isAutoDreamEnabled()).toBe(false);
  });

  test("does not run the agent when disabled", async () => {
    let ran = false;
    const n = await maybeRunConsolidation({
      cwd,
      mainModelId: "m",
      runner: async () => {
        ran = true;
        return 3;
      },
    });
    expect(ran).toBe(false);
    expect(n).toBe(0);
  });

  test("runs when enabled and gates pass (no prior lock, 0 min thresholds)", async () => {
    setSettingValue("memory.enabled", true);
    setSettingValue("memory.autoDream", true);
    setSettingValue("memory.dreamMinHours", 0.0001);
    setSettingValue("memory.dreamMinSessions", 0);
    let ran = false;
    const n = await maybeRunConsolidation({
      cwd,
      mainModelId: "m",
      runner: async () => {
        ran = true;
        return 2;
      },
    });
    expect(isAutoDreamEnabled()).toBe(true);
    expect(ran).toBe(true);
    expect(n).toBe(2);
    // Lock now stamped → an immediate second run is time-gated out.
    let ran2 = false;
    await maybeRunConsolidation({
      cwd,
      mainModelId: "m",
      runner: async () => {
        ran2 = true;
        return 1;
      },
    });
    expect(ran2).toBe(false);
  });
});

describe("Memory tool: get", () => {
  let home: string;
  const cwd = "/proj/get";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kc-mem-get-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    delete process.env.KNIGHTCODE_HOME;
    rmHome(home);
  });

  test("returns the full body, errors on missing", async () => {
    upsertMemory(cwd, {
      name: "x",
      description: "d",
      type: "user",
      body: "the full body",
    });
    const got = (await memoryToolExecute(
      { action: "get", name: "x" },
      { executionRoot: cwd },
    )) as { found: boolean; body?: string };
    expect(got.found).toBe(true);
    expect(got.body).toBe("the full body");

    const miss = (await memoryToolExecute(
      { action: "get", name: "nope" },
      { executionRoot: cwd },
    )) as { found: boolean };
    expect(miss.found).toBe(false);
  });
});
