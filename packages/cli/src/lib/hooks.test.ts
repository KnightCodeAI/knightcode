import { describe, expect, test } from "bun:test";
import { mergeSystemMessages } from "./hooks";

describe("mergeSystemMessages", () => {
  test("joins systemMessages from multiple hook outputs, skipping empties", () => {
    expect(
      mergeSystemMessages([
        { systemMessage: "first" },
        null,
        { decision: "approve" },
        { systemMessage: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  test("returns undefined when no hook produced a systemMessage", () => {
    expect(mergeSystemMessages([null, {}])).toBeUndefined();
  });
});
