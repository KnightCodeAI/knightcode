import { describe, expect, test } from "bun:test";
import { DEFAULT_CHAT_MODEL_ID } from "@repo/shared";
import { resolveSubagentModel } from "./resolve-subagent-model";

describe("resolveSubagentModel", () => {
  test("user override (raw id) wins over everything", () => {
    expect(
      resolveSubagentModel({ override: "z-ai/glm-5.2", aliasArg: "opus", agentModel: "haiku" }),
    ).toBe("z-ai/glm-5.2");
  });
  test("falls back to the alias arg", () => {
    expect(resolveSubagentModel({ aliasArg: "opus" })).toBe("anthropic/claude-opus-4.8");
  });
  test("then the agent default (non-inherit alias)", () => {
    expect(resolveSubagentModel({ agentModel: "haiku" })).toBe("anthropic/claude-haiku-4.5");
  });
  test("ignores agentModel='inherit' and falls to default", () => {
    expect(resolveSubagentModel({ agentModel: "inherit" })).toBe(DEFAULT_CHAT_MODEL_ID);
  });
  test("ignores an unknown override id and uses the next source", () => {
    expect(resolveSubagentModel({ override: "not-a-real-id", aliasArg: "glm" })).toBe("z-ai/glm-5.2");
  });
});
