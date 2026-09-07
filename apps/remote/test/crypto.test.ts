import { describe, expect, it } from "vitest";
import { randomId, sha256Hex, sign, verify } from "../src/crypto.ts";

describe("crypto helpers", () => {
	it("produces distinct ids of the requested strength", () => {
		const a = randomId(16);
		const b = randomId(16);
		expect(a).not.toEqual(b);
		expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
		expect(a.length).toBeGreaterThanOrEqual(25);
	});

	it("draws every character from fresh entropy rather than reusing one byte twice", () => {
		// Emitting two characters per random byte as `b & 31` then `b >> 3` looks fine
		// but leaks: both characters carry bits 3-4 of the same byte, so every adjacent
		// pair satisfies (even >> 3) === (odd & 3) and the id holds far less entropy
		// than its length claims. Independent characters break that relation constantly.
		const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
		let correlated = 0;
		let pairs = 0;
		for (let n = 0; n < 100; n++) {
			const id = randomId(16);
			for (let i = 0; i + 1 < id.length; i += 2) {
				pairs += 1;
				if (alphabet.indexOf(id[i]) >> 3 === (alphabet.indexOf(id[i + 1]) & 3)) correlated += 1;
			}
		}
		expect(pairs).toBeGreaterThan(0);
		expect(correlated).toBeLessThan(pairs);
	});

	it("round-trips a signed payload", async () => {
		const signed = await sign("secret", "account-1");
		expect(await verify("secret", signed)).toBe("account-1");
	});

	it("rejects a payload signed with a different secret or tampered with", async () => {
		const signed = await sign("secret", "account-1");
		expect(await verify("other", signed)).toBeUndefined();
		expect(await verify("secret", `account-2.${signed.split(".")[1]}`)).toBeUndefined();
		expect(await verify("secret", "garbage")).toBeUndefined();
	});

	it("hashes deterministically", async () => {
		expect(await sha256Hex("token")).toBe(await sha256Hex("token"));
		expect(await sha256Hex("token")).not.toBe(await sha256Hex("other"));
	});
});
