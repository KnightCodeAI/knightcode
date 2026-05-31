import { describe, expect, test } from "bun:test";
import { isPrivateIp } from "./execute";

describe("isPrivateIp", () => {
  test("flags private / loopback / link-local addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.0.1",
      "100.64.0.1",
      "::1",
      "localhost",
      "metadata.google.internal",
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  test("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "192.169.0.1"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});
