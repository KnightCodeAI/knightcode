import { describe, expect, test } from "bun:test";
import { formatContextWindow } from "./status-format";

describe("formatContextWindow", () => {
  test("computes percent-left + severity", () => {
    const r = formatContextWindow(64000, 128000)!;
    expect(r.percentLeft).toBe(50);
    expect(r.remainingK).toBe("64");
    expect(r.limitK).toBe("128");
    expect(r.severity).toBe("warn"); // <= 50
  });
  test("crit under 30%", () => {
    expect(formatContextWindow(100000, 128000)!.severity).toBe("crit");
  });
  test("ok above 50%", () => {
    expect(formatContextWindow(10000, 128000)!.severity).toBe("ok");
  });
  test("null when no last-input tokens", () => {
    expect(formatContextWindow(undefined, 128000)).toBeNull();
  });
});
