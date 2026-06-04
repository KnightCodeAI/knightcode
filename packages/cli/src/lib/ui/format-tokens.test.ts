import { describe, expect, test } from "bun:test";
import { estimateTokens, formatTokenCount } from "./format-tokens";

describe("estimateTokens", () => {
  test("zero / negative → 0", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(-10)).toBe(0);
  });
  test("rounds up at ~4 chars/token", () => {
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(400)).toBe(100);
  });
});

describe("formatTokenCount", () => {
  test("under 1k is the raw number", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(850)).toBe("850");
    expect(formatTokenCount(999)).toBe("999");
  });
  test("1k–10k keeps one decimal", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(1200)).toBe("1.2k");
    expect(formatTokenCount(1500)).toBe("1.5k");
  });
  test("10k+ rounds to whole k", () => {
    expect(formatTokenCount(10000)).toBe("10k");
    expect(formatTokenCount(12000)).toBe("12k");
    expect(formatTokenCount(12500)).toBe("13k");
  });
});
