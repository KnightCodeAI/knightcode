import { describe, expect, test } from "bun:test";
import { isPrivateIp, execute } from "./execute";

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

  test("flags IPv4-mapped IPv6 literals pointing at private space", () => {
    // Exercises the bespoke "::ffff:" unwrapping in isPrivateIp, including the
    // case-insensitive and hex-compressed forms.
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::FFFF:192.168.1.1",
      "::ffff:7f00:1", // hex-compressed 127.0.0.1
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  test("allows public addresses", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "172.15.0.1",
      "192.169.0.1",
      "::ffff:8.8.8.8", // mapped public
    ]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("execute", () => {
  test("upgrades http to https", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    (globalThis as any).fetch = async (url: any) => {
      fetchCalls.push(url.toString());
      return {
        ok: true,
        headers: new Headers({ "content-type": "text/plain" }),
        body: {
          getReader() {
            return {
              read: async () => ({ done: true, value: undefined }),
              releaseLock() {}
            };
          }
        }
      } as any;
    };

    const dns = require("node:dns/promises");
    const originalLookup = dns.lookup;
    dns.lookup = async () => [{ address: "8.8.8.8", family: 4 }];

    try {
      await execute({ url: "http://example.com", prompt: "test prompt", max_length: 1000 });
      expect(fetchCalls).toContain("https://example.com/");
    } finally {
      (globalThis as any).fetch = originalFetch;
      dns.lookup = originalLookup;
    }
  });
});

