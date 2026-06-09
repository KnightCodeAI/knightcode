import { expect, test } from "bun:test";
import { VERSION } from "./version";

test("VERSION is a non-empty string (dev fallback in test runs)", () => {
  expect(typeof VERSION).toBe("string");
  expect(VERSION.length).toBeGreaterThan(0);
  // No build define under `bun test`, so we get the dev fallback.
  expect(VERSION).toBe("0.0.0-dev");
});
