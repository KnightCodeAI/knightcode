import { describe, expect, test } from "bun:test";
import { isStalled } from "./stall";

describe("isStalled", () => {
  test("not stalled before the threshold", () => {
    expect(isStalled(1000, 1000)).toBe(false);
    expect(isStalled(1000, 3999, 3000)).toBe(false);
  });
  test("stalled at/after the threshold", () => {
    expect(isStalled(1000, 4000, 3000)).toBe(true);
    expect(isStalled(0, 10_000, 3000)).toBe(true);
  });
  test("custom threshold", () => {
    expect(isStalled(0, 900, 1000)).toBe(false);
    expect(isStalled(0, 1000, 1000)).toBe(true);
  });
});
