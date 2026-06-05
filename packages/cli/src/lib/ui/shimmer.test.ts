import { describe, expect, test } from "bun:test";
import {
  glimmerIndex,
  inGlimmer,
  flashOpacity,
  lighten,
  mixColor,
} from "./shimmer";

describe("glimmerIndex", () => {
  test("empty width parks the highlight off-screen", () => {
    expect(glimmerIndex(0, 0)).toBe(-100);
  });

  test("responding sweeps right → left across width+20", () => {
    const w = 6;
    // elapsed 0 → far right (off-screen), then decreases one col per 200ms.
    expect(glimmerIndex(0, w, "responding")).toBe(w + 10);
    // cyclePosition = w+10 → index 0 (left edge).
    expect(glimmerIndex((w + 10) * 200, w, "responding")).toBe(0);
    // wraps after width+20 steps.
    expect(glimmerIndex((w + 20) * 200, w, "responding")).toBe(w + 10);
  });

  test("requesting sweeps left → right, fast (50ms/col)", () => {
    const w = 6;
    expect(glimmerIndex(0, w, "requesting")).toBe(-10);
    expect(glimmerIndex(10 * 50, w, "requesting")).toBe(0);
  });
});

describe("inGlimmer", () => {
  test("only the ±1 window is highlighted", () => {
    expect(inGlimmer(4, 5)).toBe(true);
    expect(inGlimmer(5, 5)).toBe(true);
    expect(inGlimmer(6, 5)).toBe(true);
    expect(inGlimmer(3, 5)).toBe(false);
    expect(inGlimmer(7, 5)).toBe(false);
  });
});

describe("flashOpacity", () => {
  test("oscillates 0.5 → 1 → 0.5 over ~2s", () => {
    expect(flashOpacity(0)).toBeCloseTo(0.5, 5);
    expect(flashOpacity(500)).toBeCloseTo(1, 5);
    expect(flashOpacity(1000)).toBeCloseTo(0.5, 5);
    expect(flashOpacity(1500)).toBeCloseTo(0, 5);
  });
});

describe("lighten", () => {
  test("amt 1 → white, amt 0 → unchanged", () => {
    expect(lighten("#000000", 1)).toBe("#ffffff");
    expect(lighten("#808080", 0)).toBe("#808080");
  });
  test("midpoint of black is grey", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
  });
  test("passes through invalid input", () => {
    expect(lighten("gray", 0.5)).toBe("gray");
  });
});

describe("mixColor", () => {
  test("endpoints and midpoint", () => {
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
  test("passes through invalid input", () => {
    expect(mixColor("nope", "#ffffff", 0.5)).toBe("nope");
  });
});
