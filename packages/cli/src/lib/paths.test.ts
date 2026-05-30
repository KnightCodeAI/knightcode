import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";
import { knightcodeHome } from "./paths";

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
});

describe("knightcodeHome", () => {
  test("defaults to ~/.knightcode", () => {
    delete process.env.KNIGHTCODE_HOME;
    expect(knightcodeHome()).toBe(join(homedir(), ".knightcode"));
  });

  test("honors KNIGHTCODE_HOME override", () => {
    process.env.KNIGHTCODE_HOME = "/tmp/kc-test";
    expect(knightcodeHome()).toBe("/tmp/kc-test");
  });
});
