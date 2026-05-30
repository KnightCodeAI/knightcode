import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadAgents, resolveAgentTools, getAgent, clearAgentCache } from "./loader";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "kc-agents-"));
}

describe("agent loader", () => {
  test("returns built-in agents including general-purpose", () => {
    const agents = loadAgents(tmpProject());
    expect(getAgent(agents, "general-purpose")).toBeDefined();
    expect(getAgent(agents, "Explore")).toBeDefined();
  });

  test("parses a custom agent from .knightcode/agents/*.md", () => {
    const root = tmpProject();
    mkdirSync(join(root, ".knightcode", "agents"), { recursive: true });
    writeFileSync(
      join(root, ".knightcode", "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\nYou review code.`,
    );
    clearAgentCache();
    const agents = loadAgents(root);
    const reviewer = getAgent(agents, "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.whenToUse).toBe("Reviews code");
    expect(reviewer!.tools).toEqual(["Read", "Grep"]);
    expect(reviewer!.getSystemPrompt()).toContain("You review code.");
  });

  test("resolveAgentTools applies allowlist then denylist", () => {
    const all = ["Read", "Write", "Edit", "Bash"];
    expect(resolveAgentTools({ tools: ["*"] } as any, all)).toEqual(all);
    expect(resolveAgentTools({ tools: ["Read", "Write"] } as any, all)).toEqual(["Read", "Write"]);
    expect(resolveAgentTools({ disallowedTools: ["Write", "Edit"] } as any, all)).toEqual(["Read", "Bash"]);
    expect(
      resolveAgentTools({ tools: ["Read", "Write"], disallowedTools: ["Write"] } as any, all),
    ).toEqual(["Read"]);
  });
});
