import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUpdateCache, writeUpdateCache } from "./cache";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.KNIGHTCODE_HOME;
  home = mkdtempSync(join(tmpdir(), "kc-update-"));
  process.env.KNIGHTCODE_HOME = home;
});

afterEach(() => {
  if (prevHome !== undefined) process.env.KNIGHTCODE_HOME = prevHome;
  else delete process.env.KNIGHTCODE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("update cache", () => {
  test("returns null when no cache file exists", () => {
    expect(readUpdateCache()).toBeNull();
  });

  test("round-trips a written cache", () => {
    writeUpdateCache({ lastChecked: 123, latestVersion: "9.9.9" });
    expect(readUpdateCache()).toEqual({ lastChecked: 123, latestVersion: "9.9.9" });
  });

  test("returns null on malformed json", () => {
    writeUpdateCache({ lastChecked: 1, latestVersion: "1.0.0" });
    // Corrupt the file
    writeFileSync(join(home, "update-check.json"), "{not json");
    expect(readUpdateCache()).toBeNull();
  });
});
