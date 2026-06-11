import { describe, expect, test } from "bun:test";
import { NOOP_ENGINE_HOOKS } from "./hooks";

describe("NOOP_ENGINE_HOOKS", () => {
  test("pre never blocks, post returns no message, failure resolves", async () => {
    expect(await NOOP_ENGINE_HOOKS.preToolUse("Read", {})).toEqual({
      blocked: false,
    });
    expect(await NOOP_ENGINE_HOOKS.postToolUse("Read", {}, {})).toEqual({});
    await NOOP_ENGINE_HOOKS.postToolUseFailure("Read", {}, "boom");
  });
});
