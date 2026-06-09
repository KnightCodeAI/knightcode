import { describe, expect, test } from "bun:test";
import { formatDoctorReport, doctorExitCode } from "./format";
import type { DoctorCheck } from "./checks";

const checks: DoctorCheck[] = [
  { label: "OpenRouter API key", status: "warn", detail: "not configured" },
  { label: "Local store", status: "ok", detail: "ready" },
];

describe("formatDoctorReport", () => {
  test("includes a version + platform header and every check line", () => {
    const out = formatDoctorReport("0.1.0", checks);
    expect(out).toContain("knightcode 0.1.0");
    expect(out).toContain(`${process.platform}-${process.arch}`);
    expect(out).toContain("OpenRouter API key");
    expect(out).toContain("not configured");
    expect(out).toContain("Local store");
  });

  test("empty checks → header only, no throw", () => {
    const out = formatDoctorReport("0.1.0", []);
    expect(out).toContain("knightcode 0.1.0");
  });
});

describe("doctorExitCode", () => {
  test("0 when no check failed (warns are fine)", () => {
    expect(doctorExitCode(checks)).toBe(0);
  });
  test("1 when any check failed", () => {
    expect(
      doctorExitCode([...checks, { label: "Local store", status: "fail" }]),
    ).toBe(1);
  });
});
