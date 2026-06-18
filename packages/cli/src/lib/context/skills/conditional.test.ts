import { describe, it, expect } from "bun:test";
import { fileMatchesGlobs, renderConditionalBlock } from "./conditional";

describe("conditional skills", () => {
  it("matches cwd-relative paths against globs", () => {
    expect(fileMatchesGlobs(["**/*.tf"], "infra/main.tf")).toBe(true);
    expect(fileMatchesGlobs(["**/*.tf"], "main.tf")).toBe(true);
    expect(fileMatchesGlobs(["infra/**"], "infra/main.tf")).toBe(true);
    expect(fileMatchesGlobs(["infra/**"], "src/app.ts")).toBe(false);
    expect(fileMatchesGlobs(["**/*.tf"], "src/app.ts")).toBe(false);
  });

  it("normalizes backslash paths (Windows)", () => {
    expect(fileMatchesGlobs(["infra/**"], "infra\\prod\\main.tf")).toBe(true);
  });

  it("ignores empty globs and never throws", () => {
    expect(fileMatchesGlobs([""], "anything.ts")).toBe(false);
    expect(fileMatchesGlobs([], "anything.ts")).toBe(false);
  });

  it("renderConditionalBlock names the skills and is a blocking directive", () => {
    const block = renderConditionalBlock(["deploy", "terraform"]);
    expect(block).toContain("deploy");
    expect(block).toContain("terraform");
    expect(block).toMatch(/BLOCKING REQUIREMENT/);
    expect(block).toContain("Skill tool");
  });
});
