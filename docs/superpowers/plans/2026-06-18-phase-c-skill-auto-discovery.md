# Phase C — Skill Auto-Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed skills actually fire — budget-cap the skill index so a large library can't blow turn-1 tokens, add a side-query that nudges the model toward relevant skills per turn, and hot-reload edited skills without a restart.

**Architecture:** Three additive pieces riding the Phase A substrate. (1) `buildSkillIndex` gains a per-entry description cap + a total char budget. (2) A new `createSkillDiscoveryProvider` is a `turn_start` `ContextProvider` (mirrors `createMemoryRecallProvider`): it side-queries which skills match the latest user text and injects a one-line "Consider these skills" reminder, tracking a session-scoped sent-set so each skill is nudged at most once. (3) A chokidar-based watcher clears the skill cache + request-context cache when a `SKILL.md` changes, so new/edited skills appear live.

**Tech Stack:** TypeScript, Bun test runner, AI SDK (`generateText` via the existing `sideQuery` helper), React (opentui) for the session wiring, **chokidar** for cross-platform recursive skill-dir watching.

## Global Constraints

- Runtime is **Bun**; tests run via `bun test` (discovery), type-check via `bun run check-types` (`tsc --noEmit`). Both must stay green.
- **One new dependency: chokidar** (Task 6). It is added to `packages/cli`'s `devDependencies` — matching how the CLI's other runtime libs (`ai`, `react`, `drizzle-orm`, …) are declared, since the binary is bundled. chokidar gives correct recursive watching on Linux/macOS/Windows, which native `fs.watch` does not (its `recursive` option is unsupported on Linux). The watcher is still gated behind `skills.hotReload` so it can be disabled if chokidar misbehaves under Bun.
- Context providers **must never throw** and **must never persist** — `runContextProviders` swallows rejections; reminders are request-view only (`lib/engine/context-providers.ts:16-27`).
- Side queries go through `sideQuery` (`lib/inference/side-query.ts`) which already: honors the `sideQueryModel` setting, falls back to the main model, forces reasoning "low", and returns `""` on any failure.
- Skill discovery is gated behind a new `skills.autoDiscover` setting, **default on** (parity with `memory.enabled`). The watcher is gated behind `skills.hotReload`, **default on**, with a flag to disable in environments where `fs.watch` misbehaves.
- New-file headers, comment density, and naming must match the surrounding code (e.g. `recall.ts` is the canonical template for the discovery provider).

---

### Task 1: Memoize `listSkills` + add `clearSkillCaches()`

**Files:**
- Modify: `packages/cli/src/lib/context/skills.ts`
- Test: `packages/cli/src/lib/context/skills.test.ts`

**Why:** The discovery provider calls `listSkills(cwd)` every turn (a full FS scan). Memoizing per-cwd makes discovery + `buildSkillIndex` cheap, and gives the watcher a cache to clear. Existing tests each use a unique `projectDir`, so a cwd-keyed cache is transparent to them.

**Interfaces:**
- Produces: `clearSkillCaches(): void` — drops all memoized skill lists. Called by the watcher (Task 6).
- `listSkills(cwd?)` keeps its existing signature and return type (`Skill[]`); behavior is identical except results are cached per resolved cwd.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/src/lib/context/skills.test.ts`, inside the `describe("skills", ...)` block:

```typescript
  it("caches listSkills per cwd until clearSkillCaches is called", async () => {
    const { listSkills, clearSkillCaches } = await import("./skills");

    const projectDir = join(TEST_ROOT, "cache");
    const skillDir = join(projectDir, ".knightcode", "skills", "alpha");
    ensureDir(skillDir);
    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: alpha
description: First skill
---
Body.`,
    );

    const first = listSkills(projectDir);
    expect(first.find((s) => s.name === "alpha")).toBeDefined();

    // Add a second skill on disk; cached call should NOT see it yet.
    const betaDir = join(projectDir, ".knightcode", "skills", "beta");
    ensureDir(betaDir);
    writeFile(
      join(betaDir, "SKILL.md"),
      `---
name: beta
description: Second skill
---
Body.`,
    );
    const cached = listSkills(projectDir);
    expect(cached.find((s) => s.name === "beta")).toBeUndefined();

    // After clearing, the fresh scan picks it up.
    clearSkillCaches();
    const fresh = listSkills(projectDir);
    expect(fresh.find((s) => s.name === "beta")).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/lib/context/skills.test.ts`
Expected: FAIL — `clearSkillCaches` is not exported (import is `undefined`), and the `cached` assertion fails because `listSkills` currently re-scans every call.

- [ ] **Step 3: Add the cache and clear function**

In `packages/cli/src/lib/context/skills.ts`, add a module-level cache just below the imports (after line 9):

```typescript
// Memoize the (FS-scanning) skill list per resolved cwd. The discovery provider
// and buildSkillIndex hit this every turn; the watcher (lib/context/skills/
// watcher.ts) calls clearSkillCaches() when a SKILL.md changes so edits appear
// without a restart.
const skillListCache = new Map<string, Skill[]>();

/** Drop all memoized skill lists — called by the skill-dir watcher on change. */
export function clearSkillCaches(): void {
  skillListCache.clear();
}
```

Then wrap the body of `listSkills` so it consults the cache. Change the signature line and first statements (currently `packages/cli/src/lib/context/skills.ts:208-209`):

```typescript
export function listSkills(cwd = process.cwd()): Skill[] {
  const cached = skillListCache.get(cwd);
  if (cached) return cached;

  const skills = new Map<string, Skill>();
  const seenDirs = new Set<string>();
```

And replace the final `return` of `listSkills` (currently `:243-245`) with:

```typescript
  const result = Array.from(skills.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  skillListCache.set(cwd, result);
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/context/skills.test.ts`
Expected: PASS (all prior skills tests + the new caching test). Each existing test uses a distinct `projectDir`, so caching does not cross-contaminate them.

- [ ] **Step 5: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/context/skills.ts packages/cli/src/lib/context/skills.test.ts
git commit -m "feat(skills): memoize listSkills per cwd with clearSkillCaches()"
```

---

### Task 2: Budget-cap the skill index

**Files:**
- Modify: `packages/cli/src/lib/context/skills.ts` (the `buildSkillIndex` function, currently `:256-270`)
- Test: `packages/cli/src/lib/context/skills.test.ts`

**Why:** `buildSkillIndex` currently renders every model-invokable skill with its full description + `whenToUse`. A large library blows turn-1 tokens (the index sits in the cached system prompt). Port claude-code's intent: cap each entry's description and cap the total listing, with an overflow note so the model knows more exist.

**Interfaces:**
- Consumes: `listSkills` (cached, from Task 1).
- Produces: `buildSkillIndex(cwd?)` — unchanged signature/return (`string`); output is now length-bounded. Two new exported constants for tests + the discovery provider to share:
  - `MAX_LISTING_DESC_CHARS = 250`
  - `SKILL_INDEX_CHAR_BUDGET = 8000`

- [ ] **Step 1: Write the failing tests**

Add to `packages/cli/src/lib/context/skills.test.ts`:

```typescript
  it("buildSkillIndex truncates long descriptions to the cap", async () => {
    const { buildSkillIndex, MAX_LISTING_DESC_CHARS } = await import("./skills");

    const projectDir = join(TEST_ROOT, "longdesc");
    const skillDir = join(projectDir, ".knightcode", "skills", "verbose");
    ensureDir(skillDir);
    const longDesc = "x".repeat(MAX_LISTING_DESC_CHARS + 200);
    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: verbose
description: ${longDesc}
---
Body.`,
    );

    const index = buildSkillIndex(projectDir);
    // The full over-cap description must not appear verbatim.
    expect(index).not.toContain(longDesc);
    expect(index).toContain("verbose");
    // The truncation marker is present.
    expect(index).toContain("…");
  });

  it("buildSkillIndex caps the total listing and notes the overflow", async () => {
    const { buildSkillIndex, SKILL_INDEX_CHAR_BUDGET } = await import(
      "./skills"
    );

    const projectDir = join(TEST_ROOT, "manyskills");
    // Each entry is ~200 chars; create enough to exceed the budget.
    const count = Math.ceil(SKILL_INDEX_CHAR_BUDGET / 150) + 20;
    for (let i = 0; i < count; i++) {
      const dir = join(
        projectDir,
        ".knightcode",
        "skills",
        `skill-${String(i).padStart(3, "0")}`,
      );
      ensureDir(dir);
      writeFile(
        join(dir, "SKILL.md"),
        `---
name: skill-${String(i).padStart(3, "0")}
description: ${"d".repeat(120)}
---
Body.`,
      );
    }

    const index = buildSkillIndex(projectDir);
    expect(index.length).toBeLessThanOrEqual(SKILL_INDEX_CHAR_BUDGET + 200);
    expect(index).toMatch(/more skill/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/context/skills.test.ts`
Expected: FAIL — `MAX_LISTING_DESC_CHARS` / `SKILL_INDEX_CHAR_BUDGET` are undefined imports, and the current `buildSkillIndex` neither truncates nor caps.

- [ ] **Step 3: Implement the budget cap**

In `packages/cli/src/lib/context/skills.ts`, add the constants above `buildSkillIndex` (just before line 256's doc comment):

```typescript
/** Max chars of a single skill's description in the index listing. */
export const MAX_LISTING_DESC_CHARS = 250;
/** Max total chars of the rendered skill index (keeps turn-1 tokens bounded). */
export const SKILL_INDEX_CHAR_BUDGET = 8000;

function clampDesc(desc: string): string {
  const flat = desc.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LISTING_DESC_CHARS
    ? flat.slice(0, MAX_LISTING_DESC_CHARS - 1).trimEnd() + "…"
    : flat;
}
```

Replace the body of `buildSkillIndex` (`:260-270`) with:

```typescript
export function buildSkillIndex(cwd = process.cwd()): string {
  const skills = listSkills(cwd).filter((s) => !s.disableModelInvocation);
  if (skills.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const s of skills) {
    let entry = `- **${s.name}** — ${clampDesc(s.description)}`;
    if (s.whenToUse) entry += ` (Use when: ${clampDesc(s.whenToUse)})`;
    // +1 for the newline join. Always keep at least one entry.
    if (lines.length > 0 && used + entry.length + 1 > SKILL_INDEX_CHAR_BUDGET) {
      dropped = skills.length - lines.length;
      break;
    }
    lines.push(entry);
    used += entry.length + 1;
  }

  if (dropped > 0) {
    lines.push(
      `- …and ${dropped} more skill${dropped === 1 ? "" : "s"} — ask or use the Skill tool to list them.`,
    );
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/context/skills.test.ts`
Expected: PASS — including the existing `buildSkillIndex includes whenToUse hint` and `excludes model-disabled skills` tests (short descriptions are unaffected by the cap).

- [ ] **Step 5: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/context/skills.ts packages/cli/src/lib/context/skills.test.ts
git commit -m "feat(skills): budget-cap the skill index (per-entry + total)"
```

---

### Task 3: Add `skills.autoDiscover` and `skills.hotReload` settings

**Files:**
- Modify: `packages/cli/src/lib/settings.ts` (the `SUPPORTED_SETTINGS` map, `:35-62`)
- Create: `packages/cli/src/lib/context/skills/config.ts`
- Test: `packages/cli/src/lib/context/skills/config.test.ts`

**Why:** Discovery and the watcher each need an opt-out. Mirror `lib/memory/config.ts`'s `isMemoryEnabled` shape (default-on, explicit-false opts out).

**Interfaces:**
- Produces:
  - `isSkillAutoDiscoverEnabled(): boolean` — true unless `skills.autoDiscover` is explicitly `false`.
  - `isSkillHotReloadEnabled(): boolean` — true unless `skills.hotReload` is explicitly `false`.

- [ ] **Step 1: Register the settings**

In `packages/cli/src/lib/settings.ts`, add to `SUPPORTED_SETTINGS` (after the `memory.dreamMinSessions` entry at `:58-61`, before the closing `}`):

```typescript
  /** Side-query skill nudging. On unless explicitly false. */
  "skills.autoDiscover": {
    path: ["skills", "autoDiscover"],
    type: "boolean",
  },
  /** Hot-reload skills when SKILL.md files change. On unless explicitly false. */
  "skills.hotReload": { path: ["skills", "hotReload"], type: "boolean" },
```

- [ ] **Step 2: Write the failing test**

Create `packages/cli/src/lib/context/skills/config.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  isSkillAutoDiscoverEnabled,
  isSkillHotReloadEnabled,
} from "./config";

describe("skill config", () => {
  it("auto-discover defaults to enabled", () => {
    // No setting written in the test env → default on.
    expect(typeof isSkillAutoDiscoverEnabled()).toBe("boolean");
    expect(isSkillAutoDiscoverEnabled()).toBe(true);
  });

  it("hot-reload defaults to enabled", () => {
    expect(isSkillHotReloadEnabled()).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/cli && bun test src/lib/context/skills/config.test.ts`
Expected: FAIL — `./config` does not exist (module not found).

- [ ] **Step 4: Implement the config module**

Create `packages/cli/src/lib/context/skills/config.ts`:

```typescript
import { getSettingValue } from "../../settings";

/**
 * Skill auto-discovery (side-query nudging) is on by default. It only spends a
 * side query when there are eligible, not-yet-nudged skills, so "on" is cheap;
 * users opt out with `skills.autoDiscover: false`.
 */
export function isSkillAutoDiscoverEnabled(): boolean {
  return getSettingValue("skills.autoDiscover") !== false;
}

/**
 * Hot-reloading skill dirs (fs.watch) is on by default. Disable with
 * `skills.hotReload: false` in environments where fs.watch misbehaves.
 */
export function isSkillHotReloadEnabled(): boolean {
  return getSettingValue("skills.hotReload") !== false;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/context/skills/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

Run: `cd packages/cli && bun run check-types` → clean.

```bash
git add packages/cli/src/lib/settings.ts packages/cli/src/lib/context/skills/config.ts packages/cli/src/lib/context/skills/config.test.ts
git commit -m "feat(skills): add skills.autoDiscover and skills.hotReload settings"
```

---

### Task 4: Skill discovery provider (`discovery.ts`)

**Files:**
- Create: `packages/cli/src/lib/context/skills/discovery.ts`
- Test: `packages/cli/src/lib/context/skills/discovery.test.ts`

**Why:** The "automatic" layer — a `turn_start` `ContextProvider` that side-queries which installed skills match the user's request and injects a one-line nudge, so skills fire without the user naming them. Modeled directly on `createMemoryRecallProvider` (`lib/memory/recall.ts:108-143`).

**Interfaces:**
- Consumes:
  - `sideQuery` / `SideQueryParams` from `../../inference/side-query`.
  - `extractJsonArray` from `../../memory/json` (generic JSON-array extractor; reused, not duplicated).
  - `latestUserText` from `../../engine/context-providers`.
  - `listSkills` from `../skills` (cached via Task 1).
  - `ContextProvider` type from `../../engine/context-providers`.
- Produces:
  - `type DiscoverySideQueryFn = typeof sideQuery` (injected in tests).
  - `discoverRelevantSkills(opts): Promise<string[]>` — returns up to `MAX_DISCOVERED` skill names the side model judged relevant (subset of the eligible candidate names; never throws).
  - `createSkillDiscoveryProvider(opts: { mainModelId: string; getApiKey?: () => string | undefined; sideQueryImpl?: DiscoverySideQueryFn }): ContextProvider` — `phase: "turn_start"`, with a session-scoped sent-set (each skill nudged at most once) and a query cache (skip redundant side calls on retries).

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/lib/context/skills/discovery.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { Message } from "../../engine/messages";

const TEST_ROOT = resolve(__dirname, "__test_discovery__");

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}
function writeSkill(projectDir: string, name: string, desc: string) {
  const dir = join(projectDir, ".knightcode", "skills", name);
  ensureDir(dir);
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\nBody.`,
    "utf-8",
  );
}
function userMsg(text: string): Message {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] } as Message;
}

describe("skill discovery", () => {
  beforeEach(async () => {
    ensureDir(TEST_ROOT);
    const { clearSkillCaches } = await import("../skills");
    clearSkillCaches();
  });
  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("discoverRelevantSkills returns only names the side model selected", async () => {
    const { discoverRelevantSkills } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "select");
    writeSkill(projectDir, "deploy", "Deploy the app to production");
    writeSkill(projectDir, "lint", "Run linting checks");

    const fakeSideQuery = async () => '["deploy"]';
    const names = await discoverRelevantSkills({
      query: "ship the app to prod",
      cwd: projectDir,
      mainModelId: "x/y",
      sideQueryImpl: fakeSideQuery,
    });
    expect(names).toEqual(["deploy"]);
  });

  it("ignores hallucinated names not among the candidates", async () => {
    const { discoverRelevantSkills } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "halluc");
    writeSkill(projectDir, "deploy", "Deploy the app");

    const fakeSideQuery = async () => '["deploy", "nonexistent"]';
    const names = await discoverRelevantSkills({
      query: "deploy please",
      cwd: projectDir,
      mainModelId: "x/y",
      sideQueryImpl: fakeSideQuery,
    });
    expect(names).toEqual(["deploy"]);
  });

  it("returns [] when there are no skills (no side query needed)", async () => {
    const { discoverRelevantSkills } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "empty");
    ensureDir(projectDir);
    let called = false;
    const fakeSideQuery = async () => {
      called = true;
      return "[]";
    };
    const names = await discoverRelevantSkills({
      query: "anything",
      cwd: projectDir,
      mainModelId: "x/y",
      sideQueryImpl: fakeSideQuery,
    });
    expect(names).toEqual([]);
    expect(called).toBe(false);
  });

  it("provider emits a nudge once, then dedups the same skill next turn", async () => {
    const { createSkillDiscoveryProvider } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "provider");
    writeSkill(projectDir, "deploy", "Deploy the app to production");

    let calls = 0;
    const provider = createSkillDiscoveryProvider({
      mainModelId: "x/y",
      sideQueryImpl: async () => {
        calls++;
        return '["deploy"]';
      },
    });

    const first = await provider.run({
      messages: [userMsg("deploy the app")],
      cwd: projectDir,
    });
    expect(first.length).toBe(1);
    expect(first[0]).toContain("deploy");
    expect(first[0]!.toLowerCase()).toContain("skill");

    // Different query so the per-query cache doesn't short-circuit; the
    // sent-set must suppress the already-nudged "deploy".
    const second = await provider.run({
      messages: [userMsg("now deploy again to prod")],
      cwd: projectDir,
    });
    expect(second).toEqual([]);
    expect(calls).toBe(2); // side query ran both turns; dedup is post-selection
  });

  it("provider reuses the cache for an identical consecutive query", async () => {
    const { createSkillDiscoveryProvider } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "cache");
    writeSkill(projectDir, "deploy", "Deploy the app");

    let calls = 0;
    const provider = createSkillDiscoveryProvider({
      mainModelId: "x/y",
      sideQueryImpl: async () => {
        calls++;
        return '["deploy"]';
      },
    });
    const msgs = [userMsg("deploy the app")];
    const a = await provider.run({ messages: msgs, cwd: projectDir });
    const b = await provider.run({ messages: msgs, cwd: projectDir });
    expect(a).toEqual(b);
    expect(calls).toBe(1); // second identical query hits the cache
  });

  it("phase is turn_start", async () => {
    const { createSkillDiscoveryProvider } = await import("./discovery");
    const provider = createSkillDiscoveryProvider({ mainModelId: "x/y" });
    expect(provider.phase).toBe("turn_start");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/context/skills/discovery.test.ts`
Expected: FAIL — `./discovery` not found.

- [ ] **Step 3: Implement the discovery module**

Create `packages/cli/src/lib/context/skills/discovery.ts`:

```typescript
import { debugLog } from "../../debug";
import { sideQuery } from "../../inference/side-query";
import { extractJsonArray } from "../../memory/json";
import type { ContextProvider } from "../../engine/context-providers";
import { latestUserText } from "../../engine/context-providers";
import { listSkills } from "../skills";

const MAX_DISCOVERED = 5;
// Reasoning side models spend output tokens before the JSON answer; give the
// short array headroom so it isn't truncated to nothing (mirrors recall.ts).
const DISCOVERY_MAX_TOKENS = 1024;

/** Injected for tests; defaults to the real side query. */
export type DiscoverySideQueryFn = typeof sideQuery;

const DISCOVER_SYSTEM = `You help a coding assistant notice when an installed skill is relevant to the user's request. You are given the user's message and a list of available skills (name + description).

Return ONLY a JSON array of skill names (strings) that are CLEARLY relevant to this specific request — at most 5. Be selective:
- Include a skill only if it would genuinely help with this request.
- If none clearly apply, return an empty array [].
- Use the exact skill names from the list.
- Output nothing but the JSON array.`;

/**
 * Pick the installed skills most relevant to a query via a cheap side query.
 * Returns at most 5 names, each guaranteed to be an eligible candidate. Never
 * throws; returns [] when there are no eligible skills or the side model
 * declines/fails.
 */
export async function discoverRelevantSkills(opts: {
  query: string;
  cwd: string;
  mainModelId: string;
  /** Skill names already nudged this session — excluded from the candidate set. */
  alreadySent?: ReadonlySet<string>;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
  sideQueryImpl?: DiscoverySideQueryFn;
}): Promise<string[]> {
  if (!opts.query.trim()) return [];
  const candidates = listSkills(opts.cwd).filter(
    (s) =>
      !s.disableModelInvocation &&
      !(opts.alreadySent?.has(s.name) ?? false),
  );
  if (candidates.length === 0) return [];

  const manifest = candidates
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");
  const run = opts.sideQueryImpl ?? sideQuery;
  const raw = await run({
    system: DISCOVER_SYSTEM,
    prompt: `User request:\n${opts.query}\n\nAvailable skills:\n${manifest}`,
    mainModelId: opts.mainModelId,
    getApiKey: opts.getApiKey,
    signal: opts.signal,
    maxOutputTokens: DISCOVERY_MAX_TOKENS,
  });

  const valid = new Set(candidates.map((s) => s.name));
  const names = extractJsonArray(raw).filter(
    (n): n is string => typeof n === "string" && valid.has(n),
  );
  const selected: string[] = [];
  for (const name of names) {
    if (!selected.includes(name)) selected.push(name);
    if (selected.length >= MAX_DISCOVERED) break;
  }
  debugLog(
    "skills.discovery",
    `candidates=${candidates.length} rawLen=${raw.length} selected=${selected.length}`,
    selected,
  );
  return selected;
}

/** Render selected skill names into a single nudge reminder. */
export function renderDiscoveryBlock(names: string[]): string[] {
  if (names.length === 0) return [];
  return [
    `These installed skills look relevant to the current request — load one with the Skill tool if it fits: ${names.join(", ")}.`,
  ];
}

/**
 * A turn-start ContextProvider that nudges the model toward installed skills
 * relevant to the latest user message.
 *
 * Two pieces of state, both session-scoped (the provider is rebuilt when the
 * model changes, like recall):
 * - `sent`: skill names already nudged — each skill is announced at most once
 *   (mirrors claude-code's sent-set), so the channel stays low-noise.
 * - per-query cache: identical consecutive queries (retries/regenerations)
 *   reuse the last selection instead of paying for the selector again.
 */
export function createSkillDiscoveryProvider(opts: {
  mainModelId: string;
  getApiKey?: () => string | undefined;
  sideQueryImpl?: DiscoverySideQueryFn;
}): ContextProvider {
  const sent = new Set<string>();
  let cacheKey: string | null = null;
  let cacheValue: string[] = [];
  return {
    phase: "turn_start",
    run: async ({ messages, cwd, signal }) => {
      const query = latestUserText(messages);
      if (!query) return [];
      const key = JSON.stringify([cwd, query]);
      if (key === cacheKey) return cacheValue;

      const names = await discoverRelevantSkills({
        query,
        cwd,
        mainModelId: opts.mainModelId,
        alreadySent: sent,
        getApiKey: opts.getApiKey,
        signal,
        sideQueryImpl: opts.sideQueryImpl,
      });
      const fresh = names.filter((n) => !sent.has(n));
      fresh.forEach((n) => sent.add(n));
      const block = renderDiscoveryBlock(fresh);
      cacheKey = key;
      cacheValue = block;
      return block;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/context/skills/discovery.test.ts`
Expected: PASS (all six tests).

- [ ] **Step 5: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/context/skills/discovery.ts packages/cli/src/lib/context/skills/discovery.test.ts
git commit -m "feat(skills): side-query skill discovery provider"
```

---

### Task 5: Register the discovery provider in the query engine

**Files:**
- Modify: `packages/cli/src/hooks/use-query-engine.ts` (imports + provider assembly at `:31-453`)

**Why:** Wire `createSkillDiscoveryProvider` into the same `contextProviders` array the recall provider uses, gated by `isSkillAutoDiscoverEnabled()`. Reuse the model-keyed `useRef` pattern so the sent-set/cache survive across turns and rebuild only when the model changes.

**Interfaces:**
- Consumes: `createSkillDiscoveryProvider` (Task 4), `isSkillAutoDiscoverEnabled` (Task 3), the existing `recallProviderRef` ref pattern (`:135-138`).
- Produces: no new exports — behavior change only (discovery provider is pushed into `contextProviders`).

- [ ] **Step 1: Add imports**

In `packages/cli/src/hooks/use-query-engine.ts`, after the existing memory imports (near `:30-33`):

```typescript
import { isSkillAutoDiscoverEnabled } from "../lib/context/skills/config";
import { createSkillDiscoveryProvider } from "../lib/context/skills/discovery";
```

- [ ] **Step 2: Add a ref for the discovery provider**

Next to `recallProviderRef` (`:135-138`), add:

```typescript
  const discoveryProviderRef = useRef<{
    model: string;
    provider: ContextProvider;
  } | null>(null);
```

- [ ] **Step 3: Register the provider**

In the provider-assembly block (`:439-453`), after the recall `if (memoryEnabled) { ... }` block and before `contextProviders.push(createChangedFilesProvider());`, add:

```typescript
        if (isSkillAutoDiscoverEnabled()) {
          if (discoveryProviderRef.current?.model !== params.model) {
            discoveryProviderRef.current = {
              model: params.model,
              provider: createSkillDiscoveryProvider({
                mainModelId: params.model,
                getApiKey: getOpenRouterApiKey,
              }),
            };
          }
          contextProviders.push(discoveryProviderRef.current.provider);
        }
```

- [ ] **Step 4: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

- [ ] **Step 5: Run the full cli suite to confirm no regression**

Run: `cd packages/cli && bun test`
Expected: all tests pass (no behavior change for sessions without skills; discovery is a no-op when `discoverRelevantSkills` returns `[]`).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/hooks/use-query-engine.ts
git commit -m "feat(skills): register skill discovery provider in the query engine"
```

---

### Task 6: Skill-dir watcher (`watcher.ts`)

**Files:**
- Create: `packages/cli/src/lib/context/skills/watcher.ts`
- Test: `packages/cli/src/lib/context/skills/watcher.test.ts`

**Why:** Hot-reload — when a `SKILL.md` is added/edited/removed, clear the skill cache (Task 1) and the request-context cache (`invalidateRequestContextCache`, already in `build-request-context.ts:66`) so the new state appears without a restart. chokidar gives correct recursive watching across platforms; we keep a debounce wrapper to coalesce the burst of events chokidar emits per change. The debounce is the unit under test (filesystem-event timing is non-deterministic, so we test the coalescing logic directly).

**Interfaces:**
- Consumes: `chokidar` (new dep), `clearSkillCaches` (Task 1), `invalidateRequestContextCache` (`../../inference/build-request-context`), `getProjectDirsUpToRoot` (`../file-discovery`), `isSkillHotReloadEnabled` (Task 3).
- Produces:
  - `createDebouncedReload(onReload: () => void, delayMs?: number): { trigger(): void; dispose(): void }` — coalesces rapid `trigger()` calls into one `onReload()` after `delayMs` of quiet; `dispose()` cancels a pending fire. Exported for testing.
  - `startSkillWatcher(cwd?: string): () => void` — starts a chokidar watcher over the global + project skill dirs; returns a stop function. No-op (returns a no-op stop) when `skills.hotReload` is disabled or no dirs exist.

- [ ] **Step 1: Add the chokidar dependency**

Run: `cd packages/cli && bun add chokidar`
Expected: `chokidar` appears in `packages/cli/package.json` `dependencies` and `bun.lock` is updated. (If the repo convention is to keep bundled runtime libs under `devDependencies`, move the entry there to match `ai`/`react`/`drizzle-orm`; either resolves at build time since the CLI is bundled.)

Verify the import type resolves: `cd packages/cli && bun run check-types` → clean.

- [ ] **Step 2: Write the failing tests**

Create `packages/cli/src/lib/context/skills/watcher.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { createDebouncedReload, startSkillWatcher } from "./watcher";

describe("skill watcher", () => {
  it("debounces multiple triggers into a single reload", async () => {
    let reloads = 0;
    const d = createDebouncedReload(() => reloads++, 20);
    d.trigger();
    d.trigger();
    d.trigger();
    expect(reloads).toBe(0); // not yet
    await new Promise((r) => setTimeout(r, 50));
    expect(reloads).toBe(1); // coalesced into one
    d.dispose();
  });

  it("dispose cancels a pending reload", async () => {
    let reloads = 0;
    const d = createDebouncedReload(() => reloads++, 20);
    d.trigger();
    d.dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(reloads).toBe(0);
  });

  it("startSkillWatcher returns a callable stop function", () => {
    const stop = startSkillWatcher(process.cwd());
    expect(typeof stop).toBe("function");
    stop(); // must not throw
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/lib/context/skills/watcher.test.ts`
Expected: FAIL — `./watcher` not found.

- [ ] **Step 4: Implement the watcher**

Create `packages/cli/src/lib/context/skills/watcher.ts`:

```typescript
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chokidar, { type FSWatcher } from "chokidar";
import { debugLog } from "../../debug";
import { invalidateRequestContextCache } from "../../inference/build-request-context";
import { getProjectDirsUpToRoot } from "../file-discovery";
import { clearSkillCaches } from "../skills";
import { isSkillHotReloadEnabled } from "./config";

/**
 * Coalesce a burst of file events into a single reload after `delayMs` of
 * quiet. chokidar fires several events per change (add/change/unlink, plus
 * dir events), so a debounce keeps cache invalidation from thrashing.
 */
export function createDebouncedReload(
  onReload: () => void,
  delayMs = 250,
): { trigger: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onReload();
      }, delayMs);
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Watch the global + project skill dirs for SKILL.md changes and clear the
 * skill + request-context caches on change, so edited/added/removed skills
 * appear without a restart. chokidar handles recursion cross-platform. Returns
 * a stop function. No-op (returns a no-op stop) when hot-reload is disabled or
 * no skill dirs exist.
 */
export function startSkillWatcher(cwd = process.cwd()): () => void {
  if (!isSkillHotReloadEnabled()) return () => {};

  const dirs = new Set<string>();
  const globalDir = join(homedir(), ".knightcode", "skills");
  if (existsSync(globalDir)) dirs.add(globalDir);
  for (const d of getProjectDirsUpToRoot("skills", cwd)) {
    if (existsSync(d)) dirs.add(d);
  }
  if (dirs.size === 0) return () => {};

  const debounced = createDebouncedReload(() => {
    clearSkillCaches();
    invalidateRequestContextCache();
    debugLog("skills.watcher", "skill dirs changed — caches cleared");
  });

  let watcher: FSWatcher | null = null;
  try {
    watcher = chokidar.watch([...dirs], {
      // Don't fire for the initial scan — only real post-startup changes.
      ignoreInitial: true,
      // Skill bodies live at <dir>/<name>/SKILL.md; one level is enough, but
      // chokidar's default recursive watch is harmless here (dirs are small).
      depth: 2,
    });
    // Only react to SKILL.md content changes and skill dir add/remove; ignore
    // unrelated files a user might drop alongside a skill.
    watcher.on("all", (event: string, path: string) => {
      const isSkillFile = path.replace(/\\/g, "/").endsWith("/SKILL.md");
      const isDirEvent = event === "addDir" || event === "unlinkDir";
      if (isSkillFile || isDirEvent) debounced.trigger();
    });
    // Never let a watcher error crash the session.
    watcher.on("error", () => {});
  } catch {
    // chokidar refused to start (rare under Bun) — hot-reload is best-effort.
    watcher = null;
  }

  return () => {
    debounced.dispose();
    if (watcher) void watcher.close();
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/lib/context/skills/watcher.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/package.json bun.lock packages/cli/src/lib/context/skills/watcher.ts packages/cli/src/lib/context/skills/watcher.test.ts
git commit -m "feat(skills): chokidar-based skill hot-reload watcher"
```

---

### Task 7: Wire the watcher into session startup

**Files:**
- Modify: `packages/cli/src/screens/session.tsx` (imports + a new `useEffect`)

**Why:** Start the watcher once when the session screen mounts and stop it on unmount, so hot-reload is active for the life of the session.

**Interfaces:**
- Consumes: `startSkillWatcher` (Task 6).
- Produces: no new exports — a mount/unmount effect only.

- [ ] **Step 1: Add the import**

In `packages/cli/src/screens/session.tsx`, with the other `lib` imports (near `:20-27`):

```typescript
import { startSkillWatcher } from "../lib/context/skills/watcher";
```

- [ ] **Step 2: Add the watcher effect**

After the existing effects (e.g. just below the effect ending at `:425`), add a mount-once effect:

```typescript
  useEffect(() => {
    const stop = startSkillWatcher(process.cwd());
    return stop;
  }, []);
```

- [ ] **Step 3: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: clean.

- [ ] **Step 4: Run the full cli suite**

Run: `cd packages/cli && bun test`
Expected: all tests pass.

- [ ] **Step 5: Manual smoke (optional but recommended)**

With `KNIGHTCODE_DEBUG=1` set, start the TUI, add a `SKILL.md` under `.knightcode/skills/<name>/`, and confirm `~/.knightcode/debug.log` shows a `skills.watcher … caches cleared` line; the new skill should appear in the index on the next turn without restart.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/screens/session.tsx
git commit -m "feat(skills): start skill hot-reload watcher on session mount"
```

---

## Self-Review

**1. Spec coverage** (Phase C changeset from `docs/knightcode-upgrade-plan-2026-06-16.md:356-377`):
- "budget-cap the skill index (`SKILL_BUDGET_CONTEXT_PERCENT`, `MAX_LISTING_DESC_CHARS=250`)" → Task 2 (`MAX_LISTING_DESC_CHARS=250` + `SKILL_INDEX_CHAR_BUDGET` char budget; deviation noted: a fixed char budget, since KC has no single context-window constant to take 1% of).
- "`discovery.ts` → `discoverRelevantSkills(signal, skillHeaders, alreadySent)` side query → ContextProvider with a sent-set" → Task 4 (signature adapted to KC's `sideQuery`/provider shapes; sent-set + per-query cache present).
- "`watcher.ts` chokidar watcher; on change clear skill cache (port debounce)" → Task 6 (chokidar as specced, for correct cross-platform recursive watching; debounce wrapper ported and unit-tested).
- "`skills.ts` add memoization cache + `clearSkillCaches()`" → Task 1.
- "wire watcher into session startup" → Task 7.
- "Gate discovery behind `skills.autoDiscover` (default on); watcher behind a flag" → Task 3 (`skills.autoDiscover` + `skills.hotReload`).
- "TEST `discovery.test.ts`, watcher debounce test" → Tasks 4 + 6.

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N" — every code step shows complete content.

**3. Type consistency:**
- `clearSkillCaches` — defined Task 1, consumed Tasks 4-test (clears between tests) + 6. ✓
- `MAX_LISTING_DESC_CHARS` / `SKILL_INDEX_CHAR_BUDGET` — defined Task 2, consumed in Task 2 tests. ✓
- `discoverRelevantSkills` / `createSkillDiscoveryProvider` / `DiscoverySideQueryFn` — defined Task 4, consumed Tasks 4 + 5. ✓
- `createDebouncedReload` / `startSkillWatcher` — defined Task 6, consumed Tasks 6 + 7. ✓
- `isSkillAutoDiscoverEnabled` / `isSkillHotReloadEnabled` — defined Task 3, consumed Tasks 5 + 6. ✓
- Provider shape (`{ phase, run }`) matches `ContextProvider` (`lib/engine/context-providers.ts:24-27`). ✓

**Deliberate deviations (with reasons):**
- **Fixed `SKILL_INDEX_CHAR_BUDGET` (8000) instead of "1% of context window"** — KC's request path has no single context-window constant to take a percentage of; a fixed char budget achieves the same "don't blow turn-1 tokens" goal and is trivially tunable.
- **Discovery is `turn_start`-only (keyed on user text), not write-pivot/inter-turn** — the high-value core; the per-round write-pivot variant from claude-code is an additive follow-up, not needed for skills to fire on the user's request.
