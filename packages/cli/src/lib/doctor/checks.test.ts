import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctorChecks } from "./checks";

describe("runDoctorChecks", () => {
  test("returns one entry per known check with a valid status", () => {
    const checks = runDoctorChecks();
    const labels = checks.map((c) => c.label);
    expect(labels).toContain("OpenRouter API key");
    expect(labels).toContain("Local store");
    expect(labels).toContain("Git available");
    expect(labels).toContain("Runtime");
    for (const c of checks) {
      expect(["ok", "warn", "fail"]).toContain(c.status);
    }
  });

  test("missing API key is a warn, never a fail", () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    // Point config at an empty OS temp dir so no credentials.json key is found.
    const prevHome = process.env.KNIGHTCODE_HOME;
    const home = mkdtempSync(join(tmpdir(), "kc-doctor-"));
    process.env.KNIGHTCODE_HOME = home;
    try {
      const key = runDoctorChecks().find((c) => c.label === "OpenRouter API key");
      expect(key?.status).toBe("warn");
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
      if (prevHome !== undefined) process.env.KNIGHTCODE_HOME = prevHome;
      else delete process.env.KNIGHTCODE_HOME;
      // Best-effort: the doctor's store check leaves the sqlite handle open,
      // which locks the dir on Windows. The OS reaps its own temp dir anyway.
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* held open on Windows — ignore */
      }
    }
  });
});
