import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewerVersion, getAvailableUpdate, shouldRefresh } from "./check";
import { writeUpdateCache } from "./cache";

describe("isNewerVersion", () => {
  test("compares semver numerically", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true); // not lexical
  });
  test("dev/garbage current → never prompts", () => {
    expect(isNewerVersion("1.0.0", "0.0.0-dev")).toBe(true);
    expect(isNewerVersion("garbage", "0.1.0")).toBe(false);
  });
});

describe("getAvailableUpdate", () => {
  let home: string;
  let prevHome: string | undefined;
  beforeEach(() => {
    prevHome = process.env.KNIGHTCODE_HOME;
    home = mkdtempSync(join(tmpdir(), "kc-upd-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    if (prevHome !== undefined) process.env.KNIGHTCODE_HOME = prevHome;
    else delete process.env.KNIGHTCODE_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  test("null when no cache", () => {
    expect(getAvailableUpdate("0.1.0")).toBeNull();
  });
  test("returns cached latest when newer", () => {
    writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.2.0" });
    expect(getAvailableUpdate("0.1.0")).toBe("0.2.0");
  });
  test("null when cached latest is not newer", () => {
    writeUpdateCache({ lastChecked: Date.now(), latestVersion: "0.1.0" });
    expect(getAvailableUpdate("0.1.0")).toBeNull();
  });
});

describe("shouldRefresh", () => {
  test("false when KNIGHTCODE_NO_UPDATE_CHECK is set", () => {
    const prev = process.env.KNIGHTCODE_NO_UPDATE_CHECK;
    process.env.KNIGHTCODE_NO_UPDATE_CHECK = "1";
    try {
      expect(shouldRefresh(null, Date.now())).toBe(false);
    } finally {
      if (prev !== undefined) process.env.KNIGHTCODE_NO_UPDATE_CHECK = prev;
      else delete process.env.KNIGHTCODE_NO_UPDATE_CHECK;
    }
  });

  test("false when cache is fresh (<24h)", () => {
    const prev = process.env.KNIGHTCODE_NO_UPDATE_CHECK;
    delete process.env.KNIGHTCODE_NO_UPDATE_CHECK;
    try {
      const now = Date.now();
      expect(shouldRefresh({ lastChecked: now, latestVersion: "1.0.0" }, now)).toBe(false);
    } finally {
      if (prev !== undefined) process.env.KNIGHTCODE_NO_UPDATE_CHECK = prev;
    }
  });

  test("true when cache is missing or stale (>24h)", () => {
    const prev = process.env.KNIGHTCODE_NO_UPDATE_CHECK;
    delete process.env.KNIGHTCODE_NO_UPDATE_CHECK;
    try {
      const now = Date.now();
      expect(shouldRefresh(null, now)).toBe(true);
      expect(shouldRefresh({ lastChecked: now - 25 * 60 * 60 * 1000, latestVersion: "1.0.0" }, now)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.KNIGHTCODE_NO_UPDATE_CHECK = prev;
    }
  });
});
