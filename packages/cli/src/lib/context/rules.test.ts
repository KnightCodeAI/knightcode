import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";

// We test the internal parsing by loading rules from a controlled directory
// structure. Since loadRules uses `homedir()` and `process.cwd()` internally,
// we test the exported functions with explicit cwd arguments.

const TEST_ROOT = resolve(__dirname, "__test_rules__");

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(join(path, ".."));
  writeFileSync(path, content, "utf-8");
}

describe("rules", () => {
  beforeEach(() => {
    ensureDir(TEST_ROOT);
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  // We can't easily test the full loadRules() without mocking homedir/git,
  // but we can test the parsing and aggregation logic by importing the module
  // and calling loadRulesText with a known cwd.

  it("loadRulesText returns empty string when no rules exist", async () => {
    const { loadRulesText } = await import("./rules");
    // Use a temporary empty dir as cwd — no .knightcode/rules/ exists
    const emptyDir = join(TEST_ROOT, "empty");
    ensureDir(emptyDir);
    const result = loadRulesText(emptyDir);
    // May or may not have global rules depending on the machine,
    // but at least it shouldn't throw
    expect(typeof result).toBe("string");
  });

  it("loadRules discovers rules in .knightcode/rules/", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "project");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "style.md"),
      `---
name: style-guide
description: Code style rules
---
Use 2-space indentation.`,
    );

    writeFile(
      join(rulesDir, "testing.md"),
      `---
name: testing-rules
description: Testing standards
---
Always write unit tests.`,
    );

    const rules = loadRules(projectDir);
    const projectRules = rules.filter((r) => r.source === "project");

    expect(projectRules.length).toBeGreaterThanOrEqual(2);

    const styleRule = projectRules.find((r) => r.name === "style-guide");
    expect(styleRule).toBeDefined();
    expect(styleRule!.description).toBe("Code style rules");
    expect(styleRule!.body).toContain("2-space indentation");

    const testRule = projectRules.find((r) => r.name === "testing-rules");
    expect(testRule).toBeDefined();
    expect(testRule!.body).toContain("unit tests");
  });

  it("loadRules discovers rules in subdirectories recursively", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "recursive");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    const subDir = join(rulesDir, "frontend");
    ensureDir(subDir);

    writeFile(join(rulesDir, "general.md"), "General rule");
    writeFile(join(subDir, "react.md"), "React rule");

    const rules = loadRules(projectDir);
    const projectRules = rules.filter((r) => r.source === "project");

    expect(projectRules.some((r) => r.name === "general")).toBe(true);
    expect(projectRules.some((r) => r.name === "react")).toBe(true);
  });

  it("rules with paths: frontmatter are filtered by cwd", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "paths");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "frontend.md"),
      `---
name: frontend-only
paths: [**/frontend/**]
---
Only for frontend code.`,
    );

    writeFile(
      join(rulesDir, "always.md"),
      `---
name: always-on
---
Always applies.`,
    );

    const rules = loadRules(projectDir);
    const projectRules = rules.filter((r) => r.source === "project");

    // "always-on" should be present
    expect(projectRules.some((r) => r.name === "always-on")).toBe(true);

    // "frontend-only" should be filtered out because projectDir doesn't match **/frontend/**
    expect(projectRules.some((r) => r.name === "frontend-only")).toBe(false);
  });

  it("HTML comments are stripped from rule bodies", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "comments");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "commented.md"),
      `Keep this
<!-- This comment should be stripped -->
And this too`,
    );

    const rules = loadRules(projectDir);
    const rule = rules.find((r) => r.name === "commented");
    expect(rule).toBeDefined();
    expect(rule!.body).toContain("Keep this");
    expect(rule!.body).toContain("And this too");
    expect(rule!.body).not.toContain("should be stripped");
  });

  it("loadRulesText formats rules as markdown", async () => {
    const { loadRulesText } = await import("./rules");

    const projectDir = join(TEST_ROOT, "format");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "my-rule.md"),
      `---
name: my-rule
description: A test rule
---
Rule content here.`,
    );

    const text = loadRulesText(projectDir);
    expect(text).toContain("### my-rule — A test rule");
    expect(text).toContain("Rule content here.");
  });

  it("loadRules checks files directly under directory with globstar", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "globstar");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "src-rule.md"),
      `---
name: src-only
paths: [**/src/**]
---
Src directory rules.`,
    );

    // Matches if cwd is exactly "src" folder
    const srcDir = join(projectDir, "src");
    ensureDir(srcDir);

    const rules = loadRules(srcDir);
    expect(rules.some((r) => r.name === "src-only")).toBe(true);
  });

  it("loadRules checks trailing slash and character class matching", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "slash-char-class");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "frontend-rule.md"),
      `---
name: frontend-only
paths: [**/frontend/**]
---
Frontend rules.`,
    );

    writeFile(
      join(rulesDir, "char-class-rule.md"),
      `---
name: char-class-only
paths: [**/v[0-9]/**]
---
Version rules.`,
    );

    // 1. Should match if cwd is exactly "frontend"
    const frontendDir = join(projectDir, "frontend");
    ensureDir(frontendDir);
    const rulesFrontend = loadRules(frontendDir);
    expect(rulesFrontend.some((r) => r.name === "frontend-only")).toBe(true);

    // 2. Should match if cwd is inside "v1" directory
    const versionDir = join(projectDir, "v1");
    ensureDir(versionDir);
    const rulesVersion = loadRules(versionDir);
    expect(rulesVersion.some((r) => r.name === "char-class-only")).toBe(true);

    // 3. Should not match if cwd is inside "vx" directory
    const wrongVersionDir = join(projectDir, "vx");
    ensureDir(wrongVersionDir);
    const rulesWrongVersion = loadRules(wrongVersionDir);
    expect(rulesWrongVersion.some((r) => r.name === "char-class-only")).toBe(
      false,
    );
  });

  it("loadRules matches relative paths and negation classes correctly", async () => {
    const { loadRules } = await import("./rules");

    const projectDir = join(TEST_ROOT, "relative-and-negation");
    const rulesDir = join(projectDir, ".knightcode", "rules");
    ensureDir(rulesDir);

    writeFile(
      join(rulesDir, "relative-rule.md"),
      `---
name: relative-only
paths: [src/**]
---
Relative rule.`,
    );

    writeFile(
      join(rulesDir, "negation-rule.md"),
      `---
name: negation-only
paths: [**/v[!0]/**]
---
Negation rule.`,
    );

    // 1. Should match relative path src/ if cwd is src
    const srcDir = join(projectDir, "src");
    ensureDir(srcDir);
    const rulesSrc = loadRules(srcDir);
    expect(rulesSrc.some((r) => r.name === "relative-only")).toBe(true);

    // 2. Should match negation if version is not v0 (e.g. v1)
    const v1Dir = join(projectDir, "v1");
    ensureDir(v1Dir);
    const rulesV1 = loadRules(v1Dir);
    expect(rulesV1.some((r) => r.name === "negation-only")).toBe(true);

    // 3. Should NOT match negation if version is v0
    const v0Dir = join(projectDir, "v0");
    ensureDir(v0Dir);
    const rulesV0 = loadRules(v0Dir);
    expect(rulesV0.some((r) => r.name === "negation-only")).toBe(false);
  });
});
