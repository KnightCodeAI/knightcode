import { describe, expect, test } from "bun:test";
import { frameAt } from "./spinner-frame";

describe("frameAt", () => {
  test("advances every interval and wraps", () => {
    expect(frameAt(0, 6, 100)).toBe(0);
    expect(frameAt(50, 6, 100)).toBe(0);
    expect(frameAt(100, 6, 100)).toBe(1);
    expect(frameAt(550, 6, 100)).toBe(5);
    expect(frameAt(600, 6, 100)).toBe(0); // wraps
  });
  test("guards zero inputs", () => {
    expect(frameAt(100, 0, 100)).toBe(0);
    expect(frameAt(100, 6, 0)).toBe(0);
  });
});
