import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCredentialsPath,
  getOpenRouterApiKey,
  getSearchApiKey,
  getSearchProvider,
  saveCredentials,
} from "./credentials";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-cred-"));
  process.env.KNIGHTCODE_HOME = dir;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
  delete process.env.KNIGHTCODE_SEARCH_API_KEY;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("credentials", () => {
  test("save then read round-trips via the file", () => {
    saveCredentials({ openRouterApiKey: "sk-or-abc" });
    expect(getOpenRouterApiKey()).toBe("sk-or-abc");
  });

  test("env var overrides the file for the OpenRouter key", () => {
    saveCredentials({ openRouterApiKey: "from-file" });
    process.env.OPENROUTER_API_KEY = "from-env";
    expect(getOpenRouterApiKey()).toBe("from-env");
  });

  test("saveCredentials merges without dropping other fields", () => {
    saveCredentials({ openRouterApiKey: "k" });
    saveCredentials({ searchProvider: "brave", searchApiKey: "s" });
    expect(getOpenRouterApiKey()).toBe("k");
    expect(getSearchProvider()).toBe("brave");
    expect(getSearchApiKey()).toBe("s");
  });

  test("missing values resolve to undefined", () => {
    expect(getOpenRouterApiKey()).toBeUndefined();
    expect(getSearchProvider()).toBeUndefined();
  });

  test("an unsupported persisted searchProvider resolves to undefined", () => {
    saveCredentials({
      searchProvider: "unsupported_provider" as unknown as never,
    });
    expect(getSearchProvider()).toBeUndefined();
  });

  test("credentials file is 0600 on POSIX", () => {
    if (process.platform === "win32") return; // mode bits not enforced on Windows
    saveCredentials({ openRouterApiKey: "k" });
    const mode = statSync(getCredentialsPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("saveCredentials re-hardens an existing loose-permission file (POSIX)", () => {
    if (process.platform === "win32") return; // mode bits not enforced on Windows
    const path = getCredentialsPath();
    writeFileSync(path, "{}", { mode: 0o644 });
    chmodSync(path, 0o644); // force loose mode regardless of umask
    saveCredentials({ openRouterApiKey: "k" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
