import { describe, it, expect } from "bun:test";
import { shouldRenderDiffBody } from "./diff-visibility";

describe("shouldRenderDiffBody", () => {
  it("shows the diff only once the edit applied successfully", () => {
    expect(shouldRenderDiffBody("output-available", undefined)).toBe(true);
  });

  it("hides the diff for a failed/invalid/rejected edit", () => {
    expect(
      shouldRenderDiffBody("output-error", "File has not been read yet"),
    ).toBe(false);
  });

  it("hides the diff when an error rides along with a success state", () => {
    // Defense in depth: even if a part somehow carries `output-available` AND an
    // errorText, the error wins — no diff for a change that didn't apply.
    expect(shouldRenderDiffBody("output-available", "some error")).toBe(false);
  });

  it("hides the diff while the call is still in flight", () => {
    expect(shouldRenderDiffBody("input-available", undefined)).toBe(false);
    expect(shouldRenderDiffBody("input-streaming", undefined)).toBe(false);
    expect(shouldRenderDiffBody(undefined, undefined)).toBe(false);
  });
});
