import { describe, expect, test } from "vitest";
import { assertPublicUrl, isBlockedHostname, isPrivateAddress } from "../src/web/guard.ts";

const publicLookup = async () => ({ address: "93.184.216.34" });
const privateLookup = async () => ({ address: "10.1.2.3" });

describe("isPrivateAddress", () => {
	test.each([
		["10.0.0.1", true],
		["172.16.0.1", true],
		["172.31.255.255", true],
		["172.32.0.1", false],
		["192.168.1.1", true],
		["127.0.0.1", true],
		["169.254.169.254", true],
		["100.64.0.1", true],
		["0.0.0.0", true],
		["8.8.8.8", false],
		["::1", true],
		["fc00::1", true],
		["fd12::1", true],
		["fe80::1", true],
		["::ffff:10.0.0.1", true],
		["2606:4700::1111", false],
	])("%s → %s", (ip, expected) => {
		expect(isPrivateAddress(ip)).toBe(expected);
	});
});

describe("isBlockedHostname", () => {
	test.each([
		["localhost", true],
		["api.localhost", true],
		["db.internal", true],
		["printer.local", true],
		["LOCALHOST.", true],
		["[::1]", true],
		["10.0.0.1", true],
		["example.com", false],
	])("%s → %s", (host, expected) => {
		expect(isBlockedHostname(host)).toBe(expected);
	});
});

describe("assertPublicUrl", () => {
	test("rejects non-http schemes", async () => {
		await expect(assertPublicUrl("ftp://example.com/x")).rejects.toThrow(/^Blocked: only http and https/);
		await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/^Blocked: only http and https/);
	});

	test("rejects garbage and over-long URLs", async () => {
		await expect(assertPublicUrl("not a url")).rejects.toThrow(/^Blocked: not a valid URL/);
		await expect(assertPublicUrl(`https://example.com/${"a".repeat(2000)}`)).rejects.toThrow(/^Blocked: URL longer/);
	});

	test("rejects embedded credentials", async () => {
		await expect(assertPublicUrl("https://user:pw@example.com/")).rejects.toThrow(/^Blocked: URLs with credentials/);
	});

	test("rejects private literals and local names without a DNS lookup", async () => {
		const lookup = async () => {
			throw new Error("lookup must not run");
		};
		await expect(assertPublicUrl("http://127.0.0.1:8080/", { lookup })).rejects.toThrow(/private or local host/);
		await expect(assertPublicUrl("http://[::1]/", { lookup })).rejects.toThrow(/private or local host/);
		await expect(assertPublicUrl("http://localhost/", { lookup })).rejects.toThrow(/private or local host/);
	});

	test("rejects a public name that resolves to a private address", async () => {
		await expect(assertPublicUrl("https://example.com/", { lookup: privateLookup })).rejects.toThrow(
			/resolves to a private address/,
		);
	});

	test("rejects a name that does not resolve", async () => {
		const lookup = async () => {
			throw new Error("ENOTFOUND");
		};
		await expect(assertPublicUrl("https://nope.example/", { lookup })).rejects.toThrow(/could not resolve/);
	});

	test("returns the parsed URL for a public host", async () => {
		const url = await assertPublicUrl("https://example.com/docs?x=1", { lookup: publicLookup });
		expect(url.href).toBe("https://example.com/docs?x=1");
	});

	test("allowHosts exempts exactly those hosts and nothing else", async () => {
		const url = await assertPublicUrl("http://127.0.0.1:9/", { allowHosts: ["127.0.0.1"] });
		expect(url.port).toBe("9");
		await expect(assertPublicUrl("http://10.0.0.1/", { allowHosts: ["127.0.0.1"] })).rejects.toThrow(/^Blocked:/);
		await expect(assertPublicUrl("ftp://127.0.0.1/", { allowHosts: ["127.0.0.1"] })).rejects.toThrow(/^Blocked:/);
	});
});
