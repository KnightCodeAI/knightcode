import { describe, expect, test } from "vitest";
import { resolveCodemodeWorkerSpecifier } from "../src/config.ts";

describe("resolveCodemodeWorkerSpecifier", () => {
	// Regression: Bun on Windows cannot map an embedded B:~BUN URL back to its entrypoint, so codemode failed in the compiled binary.
	test("uses a relative source entrypoint in Bun binaries", () => {
		expect(resolveCodemodeWorkerSpecifier("bun-binary", "file:///B:/~BUN/root/config.js")).toBe(
			"./src/extensions/codemode/worker.ts",
		);
	});

	test("uses the emitted worker beside the bundled Node module", () => {
		expect(resolveCodemodeWorkerSpecifier("bundled-node", "file:///app/chunks/config.js")).toEqual(
			new URL("file:///app/chunks/codemode-worker.js"),
		);
	});

	test("uses the codemode package worker when unbundled", () => {
		expect(resolveCodemodeWorkerSpecifier("unbundled", import.meta.url)).toBeUndefined();
	});
});
