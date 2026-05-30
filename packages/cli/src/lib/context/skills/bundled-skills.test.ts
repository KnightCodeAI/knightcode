import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { listSkills, loadSkill } from "../skills";

const TEST_ROOT = resolve(
  tmpdir(),
  "knightcode_test_bundled_skills_" + Math.random().toString(36).slice(2),
);

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(join(path, ".."));
  writeFileSync(path, content, "utf-8");
}

describe("bundled skills", () => {
  beforeEach(() => {
    ensureDir(TEST_ROOT);
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  it("loads all built-in skills by default", () => {
    const skills = listSkills(TEST_ROOT);

    // Verify some of our bundled skills are present
    const simplify = skills.find((s) => s.name === "simplify");
    const stuck = skills.find((s) => s.name === "stuck");
    const lorem = skills.find((s) => s.name === "lorem");
    const remember = skills.find((s) => s.name === "remember");
    const skillify = skills.find((s) => s.name === "skillify");
    const batch = skills.find((s) => s.name === "batch");
    const verify = skills.find((s) => s.name === "verify");

    expect(simplify).toBeDefined();
    expect(simplify!.source).toBe("bundled");

    expect(stuck).toBeDefined();
    expect(stuck!.source).toBe("bundled");

    expect(lorem).toBeDefined();
    expect(lorem!.source).toBe("bundled");

    expect(remember).toBeDefined();
    expect(remember!.source).toBe("bundled");

    expect(skillify).toBeDefined();
    expect(skillify!.source).toBe("bundled");

    expect(batch).toBeDefined();
    expect(batch!.source).toBe("bundled");

    expect(verify).toBeDefined();
    expect(verify!.source).toBe("bundled");
  });

  it("can be overridden by project skills", () => {
    const projectDir = join(TEST_ROOT, "project");
    const skillDir = join(projectDir, ".knightcode", "skills", "lorem");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: lorem
description: Overridden lorem ipsum
---
Custom lorem body`,
    );

    const skills = listSkills(projectDir);
    const lorem = skills.find((s) => s.name === "lorem");
    expect(lorem).toBeDefined();
    expect(lorem!.source).toBe("project");
    expect(lorem!.description).toBe("Overridden lorem ipsum");
    expect(lorem!.body).toContain("Custom lorem body");
  });

  it("dynamically resolves skill prompt with getDynamicBody", async () => {
    const skillify = loadSkill("skillify", TEST_ROOT);
    expect(skillify).toBeDefined();
    expect(skillify!.getDynamicBody).toBeDefined();

    const body = await skillify!.getDynamicBody!(
      "focused instructions",
      "test-session-id",
    );
    expect(body).toContain("focused instructions");
    expect(body).toContain("# Skillify");
  });
});
