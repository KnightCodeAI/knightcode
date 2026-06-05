import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewerVersion, getAvailableUpdate } from "./check";
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
