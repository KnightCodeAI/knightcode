import { describe, expect, test } from "bun:test";
import {
  bulletGlyph,
  EFFORT_GLYPH,
  RESULT_GUTTER,
  SPINNER_FRAMES,
} from "./figures";

describe("figures", () => {
  test("bullet is ⏺ on darwin, ● elsewhere", () => {
    expect(bulletGlyph("darwin")).toBe("⏺");
    expect(bulletGlyph("win32")).toBe("●");
    expect(bulletGlyph("linux")).toBe("●");
  });
  test("result gutter matches the reference TUI", () => {
    expect(RESULT_GUTTER).toBe("  ⎿  ");
  });
  test("effort glyphs", () => {
    expect(EFFORT_GLYPH.low).toBe("○");
    expect(EFFORT_GLYPH.medium).toBe("◐");
    expect(EFFORT_GLYPH.high).toBe("●");
    expect(EFFORT_GLYPH.max).toBe("◉");
  });
  test("spinner has the pulsing-asterisk frames", () => {
    expect(SPINNER_FRAMES).toEqual([
      "·",
      "✢",
      "*",
      "✶",
      "✻",
      "✽",
      "✽",
      "✻",
      "✶",
      "*",
      "✢",
      "·",
    ]);
  });
});
