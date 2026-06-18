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

  it("skips the side query for an empty query (no work to do)", async () => {
    // Bundled skills always exist, so "no candidates" can't be reached via an
    // empty dir; the empty-query guard is the robust no-op path to verify.
    const { discoverRelevantSkills } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "empty");
    ensureDir(projectDir);
    let called = false;
    const fakeSideQuery = async () => {
      called = true;
      return "[]";
    };
    const names = await discoverRelevantSkills({
      query: "   ",
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

  it("excludes conditional (paths) skills from discovery candidates", async () => {
    const { discoverRelevantSkills } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "cond-exclude");
    writeSkill(projectDir, "plain", "A plain skill");
    // conditional skill with paths — must not be a candidate
    const condDir = join(projectDir, ".knightcode", "skills", "scoped");
    ensureDir(condDir);
    writeFileSync(
      join(condDir, "SKILL.md"),
      `---\nname: scoped\ndescription: Scoped skill\npaths: ["**/*.tf"]\n---\nBody.`,
      "utf-8",
    );
    const { clearSkillCaches } = await import("../skills");
    clearSkillCaches();

    // Side model tries to return both; "scoped" isn't a valid candidate so it's dropped.
    const names = await discoverRelevantSkills({
      query: "do something",
      cwd: projectDir,
      mainModelId: "x/y",
      sideQueryImpl: async () => '["plain", "scoped"]',
    });
    expect(names).toEqual(["plain"]);
  });

  it("provider fires onSurface with freshly surfaced skills", async () => {
    const { createSkillDiscoveryProvider } = await import("./discovery");
    const projectDir = join(TEST_ROOT, "surface");
    writeSkill(projectDir, "deploy", "Deploy the app");

    const surfaced: string[][] = [];
    const provider = createSkillDiscoveryProvider({
      mainModelId: "x/y",
      sideQueryImpl: async () => '["deploy"]',
      onSurface: (names) => surfaced.push(names),
    });
    await provider.run({ messages: [userMsg("deploy it")], cwd: projectDir });
    expect(surfaced).toEqual([["deploy"]]);
  });
});
