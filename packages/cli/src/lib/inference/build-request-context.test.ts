import { describe, expect, test } from "bun:test";
import { buildRequestContext } from "./build-request-context";

describe("buildRequestContext", () => {
  test("returns a prompt-context object for a real directory", () => {
    const ctx = buildRequestContext(process.cwd());
    expect(typeof ctx.platform).toBe("string");
    expect(typeof ctx.shellName).toBe("string");
    expect(Array.isArray(ctx.frameworks)).toBe(true);
    expect(typeof ctx.hasPersistedTasks).toBe("boolean");
    // string-or-undefined fields must never be null
    expect(
      ctx.gitBranchName === undefined || typeof ctx.gitBranchName === "string",
    ).toBe(true);
  });
});
