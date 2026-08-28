import { describe, expect, it } from "vitest";
import { getKnightcodeUserAgent } from "../src/utils/user-agent.ts";

describe("getKnightcodeUserAgent", () => {
	it("formats the user agent", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getKnightcodeUserAgent("1.2.3");

		expect(userAgent).toBe(`knightcode/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^knightcode\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
