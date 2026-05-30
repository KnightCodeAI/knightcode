import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";

const TEST_ROOT = resolve(__dirname, "__test_skills__");

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(join(path, ".."));
  writeFileSync(path, content, "utf-8");
}

describe("skills", () => {
  beforeEach(() => {
    ensureDir(TEST_ROOT);
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  it("listSkills discovers skills from .knightcode/skills/", async () => {
    const { listSkills } = await import("./skills");

    const projectDir = join(TEST_ROOT, "project");
    const skillDir = join(projectDir, ".knightcode", "skills", "deploy");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: deploy
description: Deploy the application to production
---
Run the deployment pipeline.`,
    );

    const skills = listSkills(projectDir);
    const projectSkills = skills.filter((s) => s.source === "project");

    expect(projectSkills.length).toBeGreaterThanOrEqual(1);
    const deploySkill = projectSkills.find((s) => s.name === "deploy");
    expect(deploySkill).toBeDefined();
    expect(deploySkill!.description).toBe(
      "Deploy the application to production",
    );
    expect(deploySkill!.body).toContain("deployment pipeline");
  });

  it("parses richer frontmatter fields", async () => {
    const { listSkills } = await import("./skills");

    const projectDir = join(TEST_ROOT, "rich");
    const skillDir = join(projectDir, ".knightcode", "skills", "test-runner");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: test-runner
description: Run project tests
when_to_use: When the user asks to run tests or check test results
argument-hint: <test-pattern>
agent: test-agent
shell: bash
context: fork
disable-model-invocation: false
user-invocable: true
allowed-tools: [bash, readFile]
arguments: [pattern, verbose]
paths: [**/src/**]
---
Execute tests with the given pattern.`,
    );

    const skills = listSkills(projectDir);
    const skill = skills.find((s) => s.name === "test-runner");
    expect(skill).toBeDefined();
    expect(skill!.whenToUse).toBe(
      "When the user asks to run tests or check test results",
    );
    expect(skill!.argumentHint).toBe("<test-pattern>");
    expect(skill!.agent).toBe("test-agent");
    expect(skill!.shell).toBe("bash");
    expect(skill!.context).toBe("fork");
    expect(skill!.disableModelInvocation).toBe(false);
    expect(skill!.userInvocable).toBe(true);
    expect(skill!.allowedTools).toEqual(["bash", "readFile"]);
    expect(skill!.arguments).toEqual(["pattern", "verbose"]);
    expect(skill!.paths).toEqual(["**/src/**"]);
  });

  it("skills without description are skipped", async () => {
    const { listSkills } = await import("./skills");

    const projectDir = join(TEST_ROOT, "nodesc");
    const skillDir = join(projectDir, ".knightcode", "skills", "broken");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: broken-skill
---
This skill has no description.`,
    );

    const skills = listSkills(projectDir);
    const broken = skills.find((s) => s.name === "broken-skill");
    expect(broken).toBeUndefined();
  });

  it("loadSkill returns null for non-existent skill", async () => {
    const { loadSkill } = await import("./skills");
    const result = loadSkill("nonexistent", TEST_ROOT);
    expect(result).toBeNull();
  });

  it("loadSkill returns the skill by name", async () => {
    const { loadSkill } = await import("./skills");

    const projectDir = join(TEST_ROOT, "load");
    const skillDir = join(projectDir, ".knightcode", "skills", "my-skill");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: My custom skill
---
Do something useful.`,
    );

    const skill = loadSkill("my-skill", projectDir);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.description).toBe("My custom skill");
  });

  it("buildSkillIndex includes whenToUse hint", async () => {
    const { buildSkillIndex } = await import("./skills");

    const projectDir = join(TEST_ROOT, "index");
    const skillDir = join(projectDir, ".knightcode", "skills", "lint");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: lint
description: Run linting checks
when_to_use: When the user mentions code quality or linting
---
Run the linter.`,
    );

    const index = buildSkillIndex(projectDir);
    expect(index).toContain("**lint**");
    expect(index).toContain("Run linting checks");
    expect(index).toContain(
      "Use when: When the user mentions code quality or linting",
    );
  });

  it("buildSkillIndex excludes model-disabled skills", async () => {
    const { buildSkillIndex } = await import("./skills");

    const projectDir = join(TEST_ROOT, "disabled");
    const visibleDir = join(projectDir, ".knightcode", "skills", "visible");
    const hiddenDir = join(projectDir, ".knightcode", "skills", "hidden");
    ensureDir(visibleDir);
    ensureDir(hiddenDir);

    writeFile(
      join(visibleDir, "SKILL.md"),
      `---
name: visible
description: A visible skill
---
Content.`,
    );

    writeFile(
      join(hiddenDir, "SKILL.md"),
      `---
name: hidden
description: A hidden skill
disable-model-invocation: true
---
Content.`,
    );

    const index = buildSkillIndex(projectDir);
    expect(index).toContain("visible");
    expect(index).not.toContain("hidden");
  });

  it("project skills override global skills with the same name", async () => {
    const { listSkills } = await import("./skills");

    const projectDir = join(TEST_ROOT, "override");
    const skillDir = join(projectDir, ".knightcode", "skills", "deploy");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: deploy
description: Project-specific deploy
---
Project deploy instructions.`,
    );

    const skills = listSkills(projectDir);
    const deploySkills = skills.filter((s) => s.name === "deploy");
    // Should have exactly one (project overrides global if both exist)
    expect(deploySkills.length).toBe(1);
    expect(deploySkills[0]!.description).toBe("Project-specific deploy");
  });

  it("HTML comments are stripped from skill body", async () => {
    const { listSkills } = await import("./skills");

    const projectDir = join(TEST_ROOT, "strip");
    const skillDir = join(projectDir, ".knightcode", "skills", "clean");
    ensureDir(skillDir);

    writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: clean
description: Clean skill
---
Keep this
<!-- Remove this comment -->
And this`,
    );

    const skills = listSkills(projectDir);
    const skill = skills.find((s) => s.name === "clean");
    expect(skill).toBeDefined();
    expect(skill!.body).toContain("Keep this");
    expect(skill!.body).toContain("And this");
    expect(skill!.body).not.toContain("Remove this comment");
  });
});
